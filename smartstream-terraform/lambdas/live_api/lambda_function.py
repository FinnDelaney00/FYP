import base64
import gzip
import json
import os
import re
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from io import BytesIO
from typing import Any, Dict, Iterable, List, Optional, Tuple

import boto3

s3_client = boto3.client("s3")
athena_client = boto3.client("athena")

DATA_LAKE_BUCKET = os.environ["DATA_LAKE_BUCKET"]
TRUSTED_PREFIX = os.environ.get("TRUSTED_PREFIX", "trusted/finance/transactions/")
EMPLOYEES_PREFIX = os.environ.get("EMPLOYEES_PREFIX", "trusted/employees/")
PREDICTIONS_PREFIX = os.environ.get("PREDICTIONS_PREFIX", "trusted-analytics/predictions/")
MAX_ITEMS_DEFAULT = int(os.environ.get("MAX_ITEMS_DEFAULT", "200"))
QUERY_MAX_ROWS = int(os.environ.get("QUERY_MAX_ROWS", str(MAX_ITEMS_DEFAULT)))
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
ATHENA_WORKGROUP = os.environ.get("ATHENA_WORKGROUP", "").strip()
ATHENA_DATABASE = os.environ.get("ATHENA_DATABASE", "").strip()
ATHENA_QUERY_TIMEOUT_SECONDS = int(os.environ.get("ATHENA_QUERY_TIMEOUT_SECONDS", "20"))
ATHENA_POLL_INTERVAL_SECONDS = float(os.environ.get("ATHENA_POLL_INTERVAL_SECONDS", "0.5"))

DATE_FIELDS = (
    "transaction_date",
    "event_time",
    "event_timestamp",
    "timestamp",
    "datetime",
    "date",
    "created_at",
    "updated_at",
)
AMOUNT_FIELDS = ("amount", "transaction_amount", "value", "total", "net_amount")
DEPT_FIELDS = ("department", "dept", "team", "division")

REVENUE_HINTS = ("revenue", "income", "credit", "sale", "sales", "deposit", "inflow", "received")
EXPENDITURE_HINTS = ("expense", "expenditure", "debit", "cost", "purchase", "withdrawal", "outflow", "payment")

FORBIDDEN_SQL_PATTERN = re.compile(
    r"\b(insert|update|delete|drop|alter|create|truncate|merge|grant|revoke|unload|call|msck|repair)\b",
    re.IGNORECASE,
)
HAS_LIMIT_PATTERN = re.compile(r"\blimit\s+\d+\b", re.IGNORECASE)


def _cors_headers() -> Dict[str, str]:
    return {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    }


def _response(status_code: int, body: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            **_cors_headers(),
        },
        "body": json.dumps(body),
    }


def _event_method(event: Dict[str, Any]) -> str:
    return (event.get("requestContext", {}).get("http", {}).get("method") or "GET").upper()


def _event_path(event: Dict[str, Any]) -> str:
    raw_path = event.get("rawPath") or event.get("requestContext", {}).get("http", {}).get("path") or "/latest"
    if not raw_path.startswith("/"):
        return f"/{raw_path}"
    return raw_path


def _parse_limit(event: Dict[str, Any]) -> int:
    query = event.get("queryStringParameters") or {}
    raw_limit = query.get("limit")

    if raw_limit is None:
        return MAX_ITEMS_DEFAULT

    try:
        limit = int(raw_limit)
    except (TypeError, ValueError):
        return MAX_ITEMS_DEFAULT

    return max(1, min(limit, MAX_ITEMS_DEFAULT))


def _decode_object_bytes(key: str, content_bytes: bytes) -> str:
    if key.endswith(".gz"):
        with gzip.GzipFile(fileobj=BytesIO(content_bytes)) as gz:
            return gz.read().decode("utf-8")
    return content_bytes.decode("utf-8")


def _parse_items(payload: str) -> List[Dict[str, Any]]:
    payload = payload.strip()
    if not payload:
        return []

    if payload.startswith("[") or payload.startswith("{"):
        try:
            decoded = json.loads(payload)
            if isinstance(decoded, list):
                return [item for item in decoded if isinstance(item, dict)]
            return [decoded] if isinstance(decoded, dict) else []
        except json.JSONDecodeError:
            # Fall back to JSON lines parsing below.
            pass

    items: List[Dict[str, Any]] = []
    for line in payload.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            items.append(parsed)
    return items


def _list_objects(prefix: str) -> List[Dict[str, Any]]:
    paginator = s3_client.get_paginator("list_objects_v2")
    objects: List[Dict[str, Any]] = []

    for page in paginator.paginate(Bucket=DATA_LAKE_BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj.get("Key", "")
            if not key or key.endswith("/"):
                continue
            objects.append(obj)

    objects.sort(key=lambda obj: obj["LastModified"], reverse=True)
    return objects


def _get_latest_object(prefix: str) -> Optional[Dict[str, Any]]:
    objects = _list_objects(prefix)
    return objects[0] if objects else None


def _read_object_text(key: str) -> str:
    response = s3_client.get_object(Bucket=DATA_LAKE_BUCKET, Key=key)
    raw_bytes = response["Body"].read()
    return _decode_object_bytes(key, raw_bytes)


def _load_records(prefix: str, max_files: int) -> Tuple[List[Dict[str, Any]], List[str]]:
    objects = _list_objects(prefix)[:max_files]
    keys = [obj["Key"] for obj in objects]
    records: List[Dict[str, Any]] = []

    for obj in objects:
        key = obj["Key"]
        try:
            payload = _read_object_text(key)
            for item in _parse_items(payload):
                enriched = dict(item)
                enriched["_source_key"] = key
                enriched["_source_last_modified"] = obj.get("LastModified").isoformat()
                records.append(enriched)
        except Exception:
            continue

    return records, keys


def _parse_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None

    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    if isinstance(value, (int, float)):
        timestamp = float(value)
        if timestamp > 10_000_000_000:
            timestamp = timestamp / 1000.0
        return datetime.fromtimestamp(timestamp, tz=timezone.utc)

    if not isinstance(value, str):
        return None

    raw = value.strip()
    if not raw:
        return None

    if raw.isdigit():
        number = float(raw)
        if len(raw) >= 13:
            number = number / 1000.0
        return datetime.fromtimestamp(number, tz=timezone.utc)

    iso_candidate = raw.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(iso_candidate)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        pass

    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S"):
        try:
            parsed = datetime.strptime(raw, fmt)
            return parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            continue

    return None


def _parse_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = value.strip().replace(",", "").replace("$", "")
        if not cleaned:
            return None
        try:
            return float(cleaned)
        except ValueError:
            return None
    return None


def _extract_amount(record: Dict[str, Any]) -> Optional[float]:
    for field in AMOUNT_FIELDS:
        if field not in record:
            continue
        parsed = _parse_float(record.get(field))
        if parsed is not None:
            return parsed

    credit = _parse_float(record.get("credit"))
    debit = _parse_float(record.get("debit"))
    if credit is not None or debit is not None:
        return (credit or 0.0) - (debit or 0.0)
    return None


def _classify_amount(record: Dict[str, Any], amount: float) -> str:
    hint_fields = [
        record.get("transaction_type"),
        record.get("type"),
        record.get("category"),
        record.get("entry_type"),
        record.get("direction"),
    ]
    hint_text = " ".join(str(item).lower() for item in hint_fields if item is not None)

    if any(token in hint_text for token in REVENUE_HINTS):
        return "revenue"
    if any(token in hint_text for token in EXPENDITURE_HINTS):
        return "expenditure"
    return "revenue" if amount >= 0 else "expenditure"


def _extract_record_date(record: Dict[str, Any]) -> Optional[str]:
    for field in DATE_FIELDS:
        parsed = _parse_datetime(record.get(field))
        if parsed is not None:
            return parsed.date().isoformat()

    fallback = _parse_datetime(record.get("_source_last_modified"))
    if fallback is not None:
        return fallback.date().isoformat()
    return None


def _parse_prediction_document(document: Dict[str, Any]) -> Dict[str, Any]:
    insights = document.get("insights") or {}
    employee_insight = insights.get("employee_growth") or {}
    finance_insight = insights.get("finance") or {}
    revenue = finance_insight.get("revenue") or {}
    expenditure = finance_insight.get("expenditure") or {}
    diagnostics = document.get("diagnostics") or {}
    rows_processed = diagnostics.get("rows_processed") or {}

    return {
        "status": document.get("status", "unknown"),
        "generated_at": document.get("generated_at"),
        "employee_history": employee_insight.get("history") or [],
        "employee_forecast": employee_insight.get("forecast") or [],
        "revenue_history": revenue.get("history") or [],
        "revenue_forecast": revenue.get("forecast") or [],
        "expenditure_history": expenditure.get("history") or [],
        "expenditure_forecast": expenditure.get("forecast") or [],
        "rows_processed": {
            "employees": int(rows_processed.get("employees") or 0),
            "finance": int(rows_processed.get("finance") or 0),
        },
        "raw": document,
    }


def _load_latest_prediction() -> Dict[str, Any]:
    latest = _get_latest_object(PREDICTIONS_PREFIX)
    if latest is None:
        return {
            "found": False,
            "key": None,
            "last_modified": None,
            "prediction": None,
        }

    try:
        payload = _read_object_text(latest["Key"])
        parsed = json.loads(payload)
        if not isinstance(parsed, dict):
            raise ValueError("Prediction payload must be an object.")
        return {
            "found": True,
            "key": latest["Key"],
            "last_modified": latest["LastModified"].isoformat(),
            "prediction": _parse_prediction_document(parsed),
        }
    except Exception as exc:
        return {
            "found": True,
            "key": latest["Key"],
            "last_modified": latest["LastModified"].isoformat(),
            "prediction": None,
            "error": str(exc),
        }


def _build_monthly_finance_chart(
    revenue_history: Iterable[Dict[str, Any]],
    expenditure_history: Iterable[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    monthly: Dict[str, Dict[str, float]] = defaultdict(lambda: {"revenue": 0.0, "expenditure": 0.0})

    for point in revenue_history:
        date_value = point.get("date")
        amount = _parse_float(point.get("revenue"))
        dt = _parse_datetime(date_value)
        if dt is None or amount is None:
            continue
        month_key = dt.strftime("%Y-%m")
        monthly[month_key]["revenue"] += max(0.0, amount)

    for point in expenditure_history:
        date_value = point.get("date")
        amount = _parse_float(point.get("expenditure"))
        dt = _parse_datetime(date_value)
        if dt is None or amount is None:
            continue
        month_key = dt.strftime("%Y-%m")
        monthly[month_key]["expenditure"] += max(0.0, amount)

    rows: List[Dict[str, Any]] = []
    for month_key in sorted(monthly.keys())[-6:]:
        year, month = month_key.split("-")
        dt = datetime(int(year), int(month), 1, tzinfo=timezone.utc)
        rows.append(
            {
                "label": dt.strftime("%b"),
                "revenue": round(monthly[month_key]["revenue"], 2),
                "expenditure": round(monthly[month_key]["expenditure"], 2),
            }
        )
    return rows


def _build_employee_growth_chart(
    employee_history: Iterable[Dict[str, Any]],
    employee_forecast: Iterable[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    points: List[Dict[str, Any]] = []

    for point in employee_history:
        dt = _parse_datetime(point.get("date"))
        value = _parse_float(point.get("headcount"))
        if dt is None or value is None:
            continue
        points.append(
            {
                "label": dt.strftime("%b %d"),
                "value": int(round(max(0.0, value))),
                "is_forecast": False,
                "sort_key": dt.isoformat(),
            }
        )

    for point in employee_forecast:
        dt = _parse_datetime(point.get("date"))
        value = _parse_float(point.get("predicted_headcount"))
        if dt is None or value is None:
            continue
        points.append(
            {
                "label": dt.strftime("%b %d"),
                "value": int(round(max(0.0, value))),
                "is_forecast": True,
                "sort_key": dt.isoformat(),
            }
        )

    points.sort(key=lambda point: point["sort_key"])
    for point in points:
        point.pop("sort_key", None)
    return points[-16:]


def _build_weekly_activity(finance_records: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    daily_counts: Dict[str, int] = defaultdict(int)

    for record in finance_records:
        day = _extract_record_date(record)
        if day:
            daily_counts[day] += 1

    rows: List[Dict[str, Any]] = []
    for day in sorted(daily_counts.keys())[-7:]:
        dt = _parse_datetime(day)
        label = dt.strftime("%a") if dt else day
        rows.append({"label": label, "value": daily_counts[day]})
    return rows


def _department_distribution(employee_records: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    counter = Counter()
    for record in employee_records:
        value = None
        for field in DEPT_FIELDS:
            if field in record:
                value = str(record[field]).strip()
                if value:
                    break
        counter[value or "Unknown"] += 1

    if not counter:
        return []

    top_departments = counter.most_common(6)
    return [{"label": label, "value": count} for label, count in top_departments]


def _metric_total_employees(employee_history: List[Dict[str, Any]], employee_forecast: List[Dict[str, Any]]) -> Dict[str, Any]:
    values = [int(_parse_float(point.get("headcount")) or 0) for point in employee_history]
    if not values:
        values = [int(_parse_float(point.get("predicted_headcount")) or 0) for point in employee_forecast]
    values = [value for value in values if value >= 0]

    if not values:
        return {"value": 0, "delta_percent": None, "subtitle": "No employee data available"}

    latest = values[-1]
    baseline = values[0] if values[0] > 0 else None
    delta_percent = None
    if baseline:
        delta_percent = round(((latest - baseline) / baseline) * 100, 2)

    return {
        "value": latest,
        "delta_percent": delta_percent,
        "subtitle": "Based on trusted employee history",
    }


def _metric_revenue(revenue_history: List[Dict[str, Any]]) -> Dict[str, Any]:
    values = [_parse_float(point.get("revenue")) for point in revenue_history]
    values = [value for value in values if value is not None and value >= 0]
    if not values:
        return {"value": 0.0, "delta_percent": None, "subtitle": "No revenue history available"}

    latest = values[-1]
    previous = values[-2] if len(values) > 1 else None
    delta_percent = None
    if previous is not None and previous != 0:
        delta_percent = round(((latest - previous) / abs(previous)) * 100, 2)

    return {
        "value": round(latest, 2),
        "delta_percent": delta_percent,
        "subtitle": "Latest revenue point from finance history",
    }


def _metric_growth_rate(employee_forecast: List[Dict[str, Any]]) -> Dict[str, Any]:
    values = [_parse_float(point.get("predicted_headcount")) for point in employee_forecast]
    values = [value for value in values if value is not None]
    if len(values) < 2:
        return {"value_percent": 0.0, "subtitle": "Not enough forecast horizon"}

    start = values[0]
    end = values[-1]
    if start == 0:
        growth_pct = 0.0
    else:
        growth_pct = ((end - start) / start) * 100

    return {
        "value_percent": round(growth_pct, 2),
        "subtitle": "Headcount trend across forecast window",
    }


def _metric_data_health(prediction: Dict[str, Any]) -> Dict[str, Any]:
    score = 0
    reasons = []

    if prediction.get("status") == "ok":
        score += 50
        reasons.append("prediction status ok")
    elif prediction.get("status") == "partial_data":
        score += 25
        reasons.append("partial data")
    else:
        reasons.append("limited prediction quality")

    rows = prediction.get("rows_processed") or {}
    total_rows = int(rows.get("employees", 0)) + int(rows.get("finance", 0))
    if total_rows > 0:
        score += 50
        reasons.append(f"{total_rows} rows processed")

    return {
        "value_percent": min(100, score),
        "subtitle": ", ".join(reasons),
    }


def _build_dashboard_payload() -> Dict[str, Any]:
    latest_finance_object = _get_latest_object(TRUSTED_PREFIX)
    finance_items: List[Dict[str, Any]] = []
    latest_finance_key = None
    latest_finance_modified = None

    if latest_finance_object:
        latest_finance_key = latest_finance_object["Key"]
        latest_finance_modified = latest_finance_object["LastModified"].isoformat()
        try:
            finance_items = _parse_items(_read_object_text(latest_finance_key))
        except Exception:
            finance_items = []

    prediction_info = _load_latest_prediction()
    prediction = prediction_info.get("prediction") or {
        "status": "no_prediction",
        "generated_at": None,
        "employee_history": [],
        "employee_forecast": [],
        "revenue_history": [],
        "revenue_forecast": [],
        "expenditure_history": [],
        "expenditure_forecast": [],
        "rows_processed": {"employees": 0, "finance": 0},
        "raw": {},
    }

    employee_records, employee_keys = _load_records(EMPLOYEES_PREFIX, max_files=12)
    finance_records, finance_keys = _load_records(TRUSTED_PREFIX, max_files=12)

    if not prediction["revenue_history"] and finance_records:
        daily_revenue: Dict[str, float] = defaultdict(float)
        daily_expenditure: Dict[str, float] = defaultdict(float)
        for record in finance_records:
            day = _extract_record_date(record)
            amount = _extract_amount(record)
            if day is None or amount is None:
                continue
            if _classify_amount(record, amount) == "revenue":
                daily_revenue[day] += abs(amount)
            else:
                daily_expenditure[day] += abs(amount)

        prediction["revenue_history"] = [
            {"date": day, "revenue": round(daily_revenue[day], 2)} for day in sorted(daily_revenue.keys())
        ]
        prediction["expenditure_history"] = [
            {"date": day, "expenditure": round(daily_expenditure[day], 2)}
            for day in sorted(daily_expenditure.keys())
        ]

    dashboard = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "metrics": {
            "total_employees": _metric_total_employees(prediction["employee_history"], prediction["employee_forecast"]),
            "revenue": _metric_revenue(prediction["revenue_history"]),
            "growth_rate": _metric_growth_rate(prediction["employee_forecast"]),
            "data_health": _metric_data_health(prediction),
        },
        "charts": {
            "revenue_expenses": _build_monthly_finance_chart(
                prediction["revenue_history"],
                prediction["expenditure_history"],
            ),
            "employee_growth": _build_employee_growth_chart(
                prediction["employee_history"],
                prediction["employee_forecast"],
            ),
            "department_distribution": _department_distribution(employee_records),
            "weekly_activity": _build_weekly_activity(finance_records),
        },
        "sources": {
            "latest_finance_key": latest_finance_key,
            "latest_finance_last_modified": latest_finance_modified,
            "latest_prediction_key": prediction_info.get("key"),
            "latest_prediction_last_modified": prediction_info.get("last_modified"),
            "employee_source_keys": employee_keys,
            "finance_source_keys": finance_keys,
            "latest_item_count": len(finance_items),
        },
    }

    return dashboard


def _forecast_payload() -> Dict[str, Any]:
    prediction_info = _load_latest_prediction()
    if not prediction_info.get("found"):
        return {
            "status": "no_prediction",
            "generated_at": None,
            "source_key": None,
            "employee_growth_forecast": [],
            "revenue_forecast": [],
            "expenditure_forecast": [],
        }

    prediction = prediction_info.get("prediction")
    if not prediction:
        return {
            "status": "invalid_prediction",
            "generated_at": None,
            "source_key": prediction_info.get("key"),
            "error": prediction_info.get("error", "Could not parse prediction payload"),
            "employee_growth_forecast": [],
            "revenue_forecast": [],
            "expenditure_forecast": [],
        }

    return {
        "status": prediction.get("status"),
        "generated_at": prediction.get("generated_at"),
        "source_key": prediction_info.get("key"),
        "employee_growth_forecast": prediction.get("employee_forecast", []),
        "revenue_forecast": prediction.get("revenue_forecast", []),
        "expenditure_forecast": prediction.get("expenditure_forecast", []),
    }


def _parse_json_body(event: Dict[str, Any]) -> Dict[str, Any]:
    body = event.get("body")
    if not body:
        return {}

    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8")

    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON body: {exc}") from exc

    if not isinstance(parsed, dict):
        raise ValueError("Request body must be a JSON object.")
    return parsed


def _normalize_sql(sql: str) -> str:
    cleaned = sql.strip().rstrip(";").strip()
    if not cleaned:
        raise ValueError("Query is empty.")
    if ";" in cleaned:
        raise ValueError("Only one SQL statement is allowed.")

    if FORBIDDEN_SQL_PATTERN.search(cleaned):
        raise ValueError("Only read-only SELECT/WITH queries are allowed.")

    lowered = cleaned.lower()
    if not (lowered.startswith("select") or lowered.startswith("with")):
        raise ValueError("Query must start with SELECT or WITH.")

    return cleaned


def _enforce_limit(sql: str, limit: int) -> str:
    safe_limit = max(1, min(limit, QUERY_MAX_ROWS))
    if HAS_LIMIT_PATTERN.search(sql):
        return sql
    return f"SELECT * FROM ({sql}) AS live_query LIMIT {safe_limit}"


def _await_athena(query_execution_id: str) -> Dict[str, Any]:
    start = time.time()

    while True:
        execution = athena_client.get_query_execution(QueryExecutionId=query_execution_id)
        status = execution["QueryExecution"]["Status"]["State"]

        if status in {"SUCCEEDED", "FAILED", "CANCELLED"}:
            return execution

        if time.time() - start > ATHENA_QUERY_TIMEOUT_SECONDS:
            try:
                athena_client.stop_query_execution(QueryExecutionId=query_execution_id)
            except Exception:
                pass
            raise TimeoutError("Athena query timed out.")

        time.sleep(max(0.1, ATHENA_POLL_INTERVAL_SECONDS))


def _fetch_athena_rows(query_execution_id: str, max_rows: int) -> Tuple[List[str], List[Dict[str, Any]]]:
    paginator = athena_client.get_paginator("get_query_results")
    pages = paginator.paginate(QueryExecutionId=query_execution_id)

    columns: List[str] = []
    rows: List[Dict[str, Any]] = []
    is_first_row_header = True

    for page in pages:
        result_set = page.get("ResultSet", {})
        metadata = result_set.get("ResultSetMetadata", {}).get("ColumnInfo", [])
        if not columns and metadata:
            columns = [col.get("Name", f"col_{idx + 1}") for idx, col in enumerate(metadata)]

        for row in result_set.get("Rows", []):
            data_cells = row.get("Data", [])
            values = [cell.get("VarCharValue") if cell else None for cell in data_cells]

            if is_first_row_header:
                is_first_row_header = False
                continue

            mapped = {}
            for index, column in enumerate(columns):
                mapped[column] = values[index] if index < len(values) else None
            rows.append(mapped)

            if len(rows) >= max_rows:
                return columns, rows

    return columns, rows


def _run_query(event: Dict[str, Any]) -> Dict[str, Any]:
    if not ATHENA_WORKGROUP or not ATHENA_DATABASE:
        raise ValueError("Athena query endpoint is not configured (missing workgroup/database).")

    body = _parse_json_body(event)
    sql = _normalize_sql(str(body.get("query", "")))
    limit = int(body.get("limit", QUERY_MAX_ROWS) or QUERY_MAX_ROWS)
    limit = max(1, min(limit, QUERY_MAX_ROWS))

    query_text = _enforce_limit(sql, limit)

    start = athena_client.start_query_execution(
        QueryString=query_text,
        QueryExecutionContext={"Database": ATHENA_DATABASE},
        WorkGroup=ATHENA_WORKGROUP,
    )
    query_execution_id = start["QueryExecutionId"]

    execution = _await_athena(query_execution_id)
    status = execution["QueryExecution"]["Status"]["State"]
    if status != "SUCCEEDED":
        reason = execution["QueryExecution"]["Status"].get("StateChangeReason", "Query failed.")
        raise RuntimeError(reason)

    columns, rows = _fetch_athena_rows(query_execution_id, max_rows=limit)
    return {
        "query_execution_id": query_execution_id,
        "columns": columns,
        "rows": rows,
        "row_count": len(rows),
    }


def _handle_latest(event: Dict[str, Any]) -> Dict[str, Any]:
    limit = _parse_limit(event)
    latest = _get_latest_object(TRUSTED_PREFIX)

    if latest is None:
        return _response(200, {"items": [], "s3_key": None, "last_modified": None})

    decoded_text = _read_object_text(latest["Key"])
    items = _parse_items(decoded_text)

    return _response(
        200,
        {
            "items": items[-limit:],
            "s3_key": latest["Key"],
            "last_modified": latest["LastModified"].isoformat(),
        },
    )


def lambda_handler(event, _context):
    method = _event_method(event)
    path = _event_path(event)

    if method == "OPTIONS":
        return {
            "statusCode": 200,
            "headers": _cors_headers(),
            "body": "",
        }

    try:
        if path == "/query":
            if method != "POST":
                return _response(405, {"message": "Method not allowed"})
            return _response(200, _run_query(event))

        if method != "GET":
            return _response(405, {"message": "Method not allowed"})

        if path in {"/latest", "/"}:
            return _handle_latest(event)
        if path == "/dashboard":
            return _response(200, _build_dashboard_payload())
        if path == "/forecasts":
            return _response(200, _forecast_payload())

        return _response(404, {"message": f"Route not found: {path}"})

    except ValueError as exc:
        return _response(400, {"message": str(exc)})
    except TimeoutError as exc:
        return _response(504, {"message": str(exc)})
    except RuntimeError as exc:
        return _response(400, {"message": str(exc)})
    except Exception as exc:
        return _response(500, {"message": f"Internal server error: {exc}"})
