import json
import logging
import os
import re
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from math import sqrt
from typing import Any, Dict, List, Optional, Tuple

import boto3

LOGGER = logging.getLogger()
if not LOGGER.handlers:
    logging.basicConfig()
LOGGER.setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())

S3_CLIENT = boto3.client("s3")
SCHEMA_VERSION = "1.0"


def _normalize_prefix(prefix: Optional[str], default: str) -> str:
    value = (prefix or default).strip().lstrip("/")
    if not value:
        value = default
    if not value.endswith("/"):
        value = f"{value}/"
    return value


def _read_int_env(name: str, default: int, minimum: int = 1) -> int:
    raw_value = os.environ.get(name, str(default))
    try:
        parsed = int(raw_value)
    except ValueError as exc:
        raise ValueError(f"Environment variable {name} must be an integer, got {raw_value!r}") from exc

    if parsed < minimum:
        raise ValueError(f"Environment variable {name} must be >= {minimum}, got {parsed}")

    return parsed


DATA_LAKE_BUCKET = os.environ["DATA_LAKE_BUCKET"]
TRUSTED_PREFIX = _normalize_prefix(os.environ.get("TRUSTED_PREFIX"), "trusted/")
ANALYTICS_PREFIX = _normalize_prefix(os.environ.get("ANALYTICS_PREFIX"), "trusted-analytics/predictions/")
MAX_INPUT_FILES = _read_int_env("MAX_INPUT_FILES", 20, minimum=1)
FORECAST_DAYS = _read_int_env("FORECAST_DAYS", 60, minimum=1)

EMPLOYEES_PREFIX = f"{TRUSTED_PREFIX}employees/"
FINANCE_PREFIX = f"{TRUSTED_PREFIX}finance/"

DATE_FIELDS = (
    "updated_at",
    "created_at",
    "timestamp",
    "datetime",
    "date",
    "transaction_date",
    "event_time",
    "event_timestamp",
    "hire_date",
)

EMPLOYEE_ID_FIELDS = ("employee_id", "emp_id", "staff_id", "person_id", "id")
AMOUNT_FIELDS = ("amount", "transaction_amount", "value", "total", "net_amount")

REVENUE_HINTS = ("revenue", "income", "credit", "sale", "sales", "deposit", "inflow", "received")
EXPENDITURE_HINTS = (
    "expense",
    "expenditure",
    "debit",
    "cost",
    "purchase",
    "withdrawal",
    "outflow",
    "payment",
)


def lambda_handler(event, context):
    run_started_at = datetime.now(timezone.utc)

    LOGGER.info("ML inference started at %s", run_started_at.isoformat())
    LOGGER.info(
        "Configuration: bucket=%s trusted_prefix=%s analytics_prefix=%s max_input_files=%d forecast_days=%d",
        DATA_LAKE_BUCKET,
        TRUSTED_PREFIX,
        ANALYTICS_PREFIX,
        MAX_INPUT_FILES,
        FORECAST_DAYS,
    )

    try:
        employee_objects = list_recent_objects(DATA_LAKE_BUCKET, EMPLOYEES_PREFIX, MAX_INPUT_FILES)
        finance_objects = list_recent_objects(DATA_LAKE_BUCKET, FINANCE_PREFIX, MAX_INPUT_FILES)

        diagnostics = {
            "event": summarize_event(event),
            "lookups": {
                "bucket": DATA_LAKE_BUCKET,
                "trusted_prefix": TRUSTED_PREFIX,
                "employees_prefix": EMPLOYEES_PREFIX,
                "finance_prefix": FINANCE_PREFIX,
                "analytics_prefix": ANALYTICS_PREFIX,
                "max_input_files": MAX_INPUT_FILES,
            },
            "input_objects": {
                "employees": [obj["Key"] for obj in employee_objects],
                "finance": [obj["Key"] for obj in finance_objects],
            },
        }

        LOGGER.info("Employees input objects: %s", diagnostics["input_objects"]["employees"])
        LOGGER.info("Finance input objects: %s", diagnostics["input_objects"]["finance"])

        employee_records = read_records_from_objects(DATA_LAKE_BUCKET, employee_objects)
        finance_records = read_records_from_objects(DATA_LAKE_BUCKET, finance_objects)

        diagnostics["rows_processed"] = {
            "employees": len(employee_records),
            "finance": len(finance_records),
        }

        LOGGER.info(
            "Rows processed: employees=%d finance=%d",
            diagnostics["rows_processed"]["employees"],
            diagnostics["rows_processed"]["finance"],
        )

        employee_insight = build_employee_growth_insight(employee_records, FORECAST_DAYS)
        finance_insight = build_finance_insight(finance_records, FORECAST_DAYS)

        if not employee_records and not finance_records:
            status = "no_input_data"
        elif employee_insight["status"] == "ok" and finance_insight["status"] == "ok":
            status = "ok"
        else:
            status = "partial_data"

        payload = {
            "schema_version": SCHEMA_VERSION,
            "generated_at": run_started_at.isoformat(),
            "status": status,
            "diagnostics": diagnostics,
            "insights": {
                "employee_growth": employee_insight,
                "finance": finance_insight,
            },
        }

        output_key = generate_output_key(run_started_at)
        write_output(payload, output_key)

        LOGGER.info("Predictions written to s3://%s/%s", DATA_LAKE_BUCKET, output_key)

        return {
            "statusCode": 200,
            "body": json.dumps(
                {
                    "status": status,
                    "output_key": output_key,
                    "rows_processed": diagnostics["rows_processed"],
                }
            ),
        }

    except Exception:
        LOGGER.exception("ML inference failed")
        raise


def summarize_event(event: Any) -> Dict[str, Any]:
    if isinstance(event, dict):
        return {
            "keys": sorted(event.keys()),
            "source": event.get("source"),
            "detail_type": event.get("detail-type"),
            "time": event.get("time"),
        }
    return {"event_type": type(event).__name__}


def list_recent_objects(bucket: str, prefix: str, limit: int) -> List[Dict[str, Any]]:
    paginator = S3_CLIENT.get_paginator("list_objects_v2")
    objects: List[Dict[str, Any]] = []

    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.endswith("/"):
                continue
            objects.append(
                {
                    "Key": key,
                    "LastModified": obj["LastModified"],
                    "Size": obj.get("Size", 0),
                }
            )

    objects.sort(key=lambda item: item["LastModified"], reverse=True)
    selected = objects[:limit]

    LOGGER.info(
        "Found %d objects under %s, selected %d most recent.",
        len(objects),
        prefix,
        len(selected),
    )

    return selected


def read_records_from_objects(bucket: str, objects: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    all_records: List[Dict[str, Any]] = []

    for obj in objects:
        key = obj["Key"]
        response = S3_CLIENT.get_object(Bucket=bucket, Key=key)
        body = response["Body"].read().decode("utf-8")

        parsed_records = parse_records(body, key)
        for record in parsed_records:
            enriched = dict(record)
            enriched["_source_key"] = key
            enriched["_source_last_modified"] = obj["LastModified"].isoformat()
            all_records.append(enriched)

        LOGGER.info("Read %d records from %s", len(parsed_records), key)

    return all_records


def parse_records(raw_text: str, source_key: str) -> List[Dict[str, Any]]:
    stripped = raw_text.strip()
    if not stripped:
        return []

    if stripped[0] in "[{":
        try:
            parsed = json.loads(stripped)
            if isinstance(parsed, dict):
                return [parsed]
            if isinstance(parsed, list):
                return [item for item in parsed if isinstance(item, dict)]
        except json.JSONDecodeError:
            LOGGER.debug("Falling back to JSON Lines parser for %s", source_key)

    records: List[Dict[str, Any]] = []
    for line_number, line in enumerate(raw_text.splitlines(), start=1):
        content = line.strip()
        if not content:
            continue

        try:
            parsed_line = json.loads(content)
        except json.JSONDecodeError as exc:
            LOGGER.warning("Skipping invalid JSON line in %s at line %d: %s", source_key, line_number, exc)
            continue

        if isinstance(parsed_line, dict):
            records.append(parsed_line)

    return records


def build_employee_growth_insight(records: List[Dict[str, Any]], forecast_days: int) -> Dict[str, Any]:
    if not records:
        return {
            "status": "insufficient_data",
            "message": f"No employee records found under {EMPLOYEES_PREFIX}.",
            "history": [],
            "forecast": [],
        }

    events: List[Tuple[datetime, str, Optional[bool]]] = []
    for record in records:
        employee_id = extract_employee_id(record)
        event_dt = extract_record_datetime(record)
        if not employee_id or not event_dt:
            continue
        events.append((event_dt, employee_id, infer_employee_active(record)))

    if not events:
        return {
            "status": "insufficient_data",
            "message": "Employee records exist but missing usable IDs/timestamps.",
            "history": [],
            "forecast": [],
        }

    events.sort(key=lambda item: item[0])

    active_ids: set[str] = set()
    counts_by_date: Dict[date, int] = {}

    for event_dt, employee_id, is_active in events:
        if is_active is False:
            active_ids.discard(employee_id)
        else:
            active_ids.add(employee_id)

        counts_by_date[event_dt.date()] = len(active_ids)

    history = build_daily_history(
        values_by_date={key: float(value) for key, value in counts_by_date.items()},
        value_name="headcount",
        carry_forward=True,
        integer_output=True,
    )

    forecast = forecast_series(
        history=history,
        history_key="headcount",
        prediction_key="predicted_headcount",
        forecast_days=forecast_days,
        integer_output=True,
    )

    return {
        "status": "ok",
        "method": "active_employee_id_trend",
        "history": history,
        "forecast": forecast,
        "forecast_days": forecast_days,
        "rows_used": len(events),
    }


def build_finance_insight(records: List[Dict[str, Any]], forecast_days: int) -> Dict[str, Any]:
    if not records:
        return insufficient_finance_result(f"No finance records found under {FINANCE_PREFIX}.")

    revenue_by_date: Dict[date, float] = defaultdict(float)
    expenditure_by_date: Dict[date, float] = defaultdict(float)
    usable_rows = 0

    for record in records:
        event_dt = extract_record_datetime(record)
        amount = extract_finance_amount(record)

        if event_dt is None or amount is None:
            continue

        usable_rows += 1

        if classify_finance_amount(record, amount) == "revenue":
            revenue_by_date[event_dt.date()] += abs(amount)
        else:
            expenditure_by_date[event_dt.date()] += abs(amount)

    if usable_rows == 0:
        return insufficient_finance_result("Finance files exist but no usable amount/timestamp records were found.")

    all_dates = sorted(set(revenue_by_date.keys()) | set(expenditure_by_date.keys()))
    if not all_dates:
        return insufficient_finance_result("No dated finance records available for forecasting.")

    start_date = all_dates[0]
    end_date = all_dates[-1]

    revenue_history = build_daily_history(
        values_by_date=revenue_by_date,
        value_name="revenue",
        carry_forward=False,
        integer_output=False,
        start_date=start_date,
        end_date=end_date,
    )
    expenditure_history = build_daily_history(
        values_by_date=expenditure_by_date,
        value_name="expenditure",
        carry_forward=False,
        integer_output=False,
        start_date=start_date,
        end_date=end_date,
    )

    revenue_status = "ok" if any(point["revenue"] > 0 for point in revenue_history) else "insufficient_data"
    expenditure_status = (
        "ok" if any(point["expenditure"] > 0 for point in expenditure_history) else "insufficient_data"
    )

    revenue_forecast = (
        forecast_series(
            history=revenue_history,
            history_key="revenue",
            prediction_key="predicted_revenue",
            forecast_days=forecast_days,
        )
        if revenue_status == "ok"
        else []
    )

    expenditure_forecast = (
        forecast_series(
            history=expenditure_history,
            history_key="expenditure",
            prediction_key="predicted_expenditure",
            forecast_days=forecast_days,
        )
        if expenditure_status == "ok"
        else []
    )

    overall_status = "ok" if revenue_status == "ok" and expenditure_status == "ok" else "insufficient_data"

    return {
        "status": overall_status,
        "forecast_days": forecast_days,
        "rows_used": usable_rows,
        "revenue": {
            "status": revenue_status,
            "history": revenue_history,
            "forecast": revenue_forecast,
        },
        "expenditure": {
            "status": expenditure_status,
            "history": expenditure_history,
            "forecast": expenditure_forecast,
        },
    }


def insufficient_finance_result(message: str) -> Dict[str, Any]:
    return {
        "status": "insufficient_data",
        "message": message,
        "revenue": {
            "status": "insufficient_data",
            "history": [],
            "forecast": [],
        },
        "expenditure": {
            "status": "insufficient_data",
            "history": [],
            "forecast": [],
        },
    }


def build_daily_history(
    values_by_date: Dict[date, float],
    value_name: str,
    carry_forward: bool,
    integer_output: bool = False,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
) -> List[Dict[str, Any]]:
    if not values_by_date:
        return []

    first_date = start_date or min(values_by_date.keys())
    last_date = end_date or max(values_by_date.keys())

    history: List[Dict[str, Any]] = []
    cursor = first_date
    current_value = 0.0

    while cursor <= last_date:
        if cursor in values_by_date:
            current_value = float(values_by_date[cursor])
        elif not carry_forward:
            current_value = 0.0

        formatted_value: Any
        if integer_output:
            formatted_value = max(0, int(round(current_value)))
        else:
            formatted_value = round(max(0.0, current_value), 2)

        history.append({"date": cursor.isoformat(), value_name: formatted_value})
        cursor += timedelta(days=1)

    return history


def forecast_series(
    history: List[Dict[str, Any]],
    history_key: str,
    prediction_key: str,
    forecast_days: int,
    integer_output: bool = False,
) -> List[Dict[str, Any]]:
    if not history:
        return []

    values = [float(point[history_key]) for point in history]
    slope, intercept, residual_std = fit_linear_trend(values)

    window = min(7, len(values))
    moving_average = sum(values[-window:]) / window

    start_date = datetime.strptime(history[-1]["date"], "%Y-%m-%d").date()

    forecast: List[Dict[str, Any]] = []
    for step in range(1, forecast_days + 1):
        trend_projection = intercept + slope * (len(values) - 1 + step)
        prediction = max(0.0, 0.7 * trend_projection + 0.3 * moving_average)

        widening_factor = 1.0 + (step / max(1, forecast_days))
        ci_half_width = max(0.01, 1.96 * residual_std * widening_factor)

        lower_bound = max(0.0, prediction - ci_half_width)
        upper_bound = max(0.0, prediction + ci_half_width)

        target_date = start_date + timedelta(days=step)

        if integer_output:
            forecast.append(
                {
                    "date": target_date.isoformat(),
                    prediction_key: int(round(prediction)),
                    "lower_ci": max(0, int(round(lower_bound))),
                    "upper_ci": max(0, int(round(upper_bound))),
                }
            )
        else:
            forecast.append(
                {
                    "date": target_date.isoformat(),
                    prediction_key: round(prediction, 2),
                    "lower_ci": round(lower_bound, 2),
                    "upper_ci": round(upper_bound, 2),
                }
            )

    return forecast


def fit_linear_trend(values: List[float]) -> Tuple[float, float, float]:
    count = len(values)
    if count == 1:
        return 0.0, values[0], 0.0

    x_values = list(range(count))
    x_mean = sum(x_values) / count
    y_mean = sum(values) / count

    denominator = sum((x - x_mean) ** 2 for x in x_values)
    if denominator == 0:
        slope = 0.0
    else:
        slope = sum((x - x_mean) * (y - y_mean) for x, y in zip(x_values, values)) / denominator

    intercept = y_mean - slope * x_mean
    residuals = [y - (intercept + slope * x) for x, y in zip(x_values, values)]
    residual_variance = sum(error**2 for error in residuals) / max(1, count - 2)
    residual_std = sqrt(residual_variance)

    return slope, intercept, residual_std


def extract_employee_id(record: Dict[str, Any]) -> Optional[str]:
    for field in EMPLOYEE_ID_FIELDS:
        if field not in record:
            continue
        value = record[field]
        if value is None:
            continue
        value_str = str(value).strip()
        if value_str:
            return value_str
    return None


def infer_employee_active(record: Dict[str, Any]) -> Optional[bool]:
    for field in ("is_active", "active"):
        if field in record:
            return parse_bool(record[field])

    status_value = record.get("employment_status") or record.get("status") or record.get("state")
    if status_value is not None:
        status = str(status_value).strip().lower()
        if status in {"active", "employed", "current"}:
            return True
        if status in {"inactive", "terminated", "left", "resigned"}:
            return False

    for field in ("termination_date", "terminated_at", "end_date", "resignation_date"):
        if field in record and str(record[field]).strip():
            return False

    return None


def parse_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0

    value_str = str(value).strip().lower()
    if value_str in {"true", "1", "yes", "y", "active", "employed"}:
        return True
    if value_str in {"false", "0", "no", "n", "inactive", "terminated"}:
        return False

    return None


def extract_finance_amount(record: Dict[str, Any]) -> Optional[float]:
    for field in AMOUNT_FIELDS:
        if field not in record:
            continue
        parsed = parse_float(record[field])
        if parsed is not None:
            return parsed

    credit = parse_float(record.get("credit"))
    debit = parse_float(record.get("debit"))
    if credit is not None or debit is not None:
        return (credit or 0.0) - (debit or 0.0)

    return None


def classify_finance_amount(record: Dict[str, Any], amount: float) -> str:
    hint_fields = [
        record.get("transaction_type"),
        record.get("type"),
        record.get("category"),
        record.get("entry_type"),
        record.get("direction"),
    ]
    hint = " ".join(str(value).lower() for value in hint_fields if value is not None)

    if any(token in hint for token in REVENUE_HINTS):
        return "revenue"
    if any(token in hint for token in EXPENDITURE_HINTS):
        return "expenditure"

    return "revenue" if amount >= 0 else "expenditure"


def parse_float(value: Any) -> Optional[float]:
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


def extract_record_datetime(record: Dict[str, Any]) -> Optional[datetime]:
    for field in DATE_FIELDS:
        if field not in record:
            continue
        parsed = parse_datetime(record[field])
        if parsed is not None:
            return parsed

    source_key = record.get("_source_key")
    if source_key:
        key_date = extract_date_from_key(str(source_key))
        if key_date:
            return datetime.combine(key_date, datetime.min.time(), tzinfo=timezone.utc)

    source_modified = record.get("_source_last_modified")
    if source_modified:
        parsed_modified = parse_datetime(source_modified)
        if parsed_modified is not None:
            return parsed_modified

    return None


def parse_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None

    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time(), tzinfo=timezone.utc)

    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=timezone.utc)

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
            parsed = parsed.replace(tzinfo=timezone.utc)
        else:
            parsed = parsed.astimezone(timezone.utc)
        return parsed
    except ValueError:
        pass

    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S"):
        try:
            parsed = datetime.strptime(raw, fmt)
            return parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            continue

    return None


def extract_date_from_key(key: str) -> Optional[date]:
    match = re.search(r"/(\d{4})/(\d{2})/(\d{2})(?:/|$)", key)
    if not match:
        return None

    year, month, day = match.groups()
    try:
        return date(int(year), int(month), int(day))
    except ValueError:
        return None


def generate_output_key(run_started_at: datetime) -> str:
    return (
        f"{ANALYTICS_PREFIX}"
        f"{run_started_at:%Y/%m/%d}/"
        f"predictions_{run_started_at:%Y%m%dT%H%M%SZ}.json"
    )


def write_output(payload: Dict[str, Any], output_key: str) -> None:
    payload_bytes = json.dumps(payload, default=str).encode("utf-8")

    S3_CLIENT.put_object(
        Bucket=DATA_LAKE_BUCKET,
        Key=output_key,
        Body=payload_bytes,
        ContentType="application/json",
        ServerSideEncryption="AES256",
    )

    LOGGER.info("Wrote %d bytes to s3://%s/%s", len(payload_bytes), DATA_LAKE_BUCKET, output_key)
