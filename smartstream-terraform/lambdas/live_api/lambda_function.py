import base64
import gzip
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from uuid import uuid4
from urllib.parse import unquote
from collections import Counter, defaultdict
from datetime import datetime, timezone
from functools import lru_cache
from io import BytesIO
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import boto3

s3_client = boto3.client("s3")
athena_client = boto3.client("athena")
glue_client = boto3.client("glue")
dynamodb = boto3.resource("dynamodb")


def _normalize_prefix(raw_prefix: Optional[str], fallback: str) -> str:
    prefix = str(raw_prefix or "").strip()
    if not prefix:
        prefix = fallback
    return prefix if prefix.endswith("/") else f"{prefix}/"


DATA_LAKE_BUCKET = os.environ["DATA_LAKE_BUCKET"]
TRUSTED_ROOT_PREFIX = _normalize_prefix(os.environ.get("TRUSTED_ROOT_PREFIX"), "trusted/")
TRUSTED_ANALYTICS_ROOT_PREFIX = _normalize_prefix(
    os.environ.get("TRUSTED_ANALYTICS_ROOT_PREFIX"), "trusted-analytics/"
)
MAX_ITEMS_DEFAULT = int(os.environ.get("MAX_ITEMS_DEFAULT", "200"))
QUERY_MAX_ROWS = int(os.environ.get("QUERY_MAX_ROWS", str(MAX_ITEMS_DEFAULT)))
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
ATHENA_WORKGROUP = os.environ.get("ATHENA_WORKGROUP", "").strip()
ATHENA_DATABASE = os.environ.get("ATHENA_DATABASE", "").strip()
ATHENA_OUTPUT_LOCATION = os.environ.get("ATHENA_OUTPUT_LOCATION", "").strip()
ATHENA_QUERY_TIMEOUT_SECONDS = int(os.environ.get("ATHENA_QUERY_TIMEOUT_SECONDS", "20"))
ATHENA_POLL_INTERVAL_SECONDS = float(os.environ.get("ATHENA_POLL_INTERVAL_SECONDS", "0.5"))
ACCOUNTS_TABLE_NAME = os.environ.get("ACCOUNTS_TABLE", "smartstream-accounts")
ANOMALY_REVIEWS_TABLE_NAME = os.environ.get("ANOMALY_REVIEWS_TABLE", "smartstream-anomaly-reviews")
COMPANIES_TABLE_NAME = os.environ.get("COMPANIES_TABLE", "smartstream-companies")
INVITES_TABLE_NAME = os.environ.get("INVITES_TABLE", "smartstream-invites")
AUTH_TOKEN_SECRET = os.environ.get("AUTH_TOKEN_SECRET", "dev-secret-change-me")
AUTH_TOKEN_TTL_SECONDS = int(os.environ.get("AUTH_TOKEN_TTL_SECONDS", "604800"))
DEFAULT_ACCOUNT_ROLE = str(os.environ.get("DEFAULT_ACCOUNT_ROLE", "member") or "member").strip().lower() or "member"

accounts_table = dynamodb.Table(ACCOUNTS_TABLE_NAME)
anomaly_reviews_table = dynamodb.Table(ANOMALY_REVIEWS_TABLE_NAME)
companies_table = dynamodb.Table(COMPANIES_TABLE_NAME)
invites_table = dynamodb.Table(INVITES_TABLE_NAME)

EMAIL_PATTERN = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
COMPANY_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{1,62}$")
SIMPLE_TRUSTED_SQL_PATTERN = re.compile(
    r"""^\s*select\s+(?P<select>.+?)\s+from\s+(?P<table>"?trusted"?)"""
    r"""(?:\s+where\s+(?P<where>.+?))?"""
    r"""(?:\s+order\s+by\s+(?P<order>.+?))?"""
    r"""(?:\s+limit\s+(?P<limit>\d+))?\s*$""",
    re.IGNORECASE | re.DOTALL,
)

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
UNSAFE_SQL_PATTERN = re.compile(r"(--|/\*|\*/|\bjoin\b|\bunion\b|\bintersect\b|\bexcept\b)", re.IGNORECASE)
HAS_LIMIT_PATTERN = re.compile(r"\blimit\s+\d+\b", re.IGNORECASE)
ANOMALY_STATUS_VALUES = {
    "new",
    "investigating",
    "reviewed",
    "confirmed",
    "false_positive",
    "resolved",
}
ALLOWED_ACCOUNT_ROLES = {"viewer", "member", "analyst", "admin"}
ACTIVE_STATUS_VALUES = {"active"}


if DEFAULT_ACCOUNT_ROLE not in ALLOWED_ACCOUNT_ROLES or DEFAULT_ACCOUNT_ROLE == "admin":
    DEFAULT_ACCOUNT_ROLE = "member"


class ForbiddenError(Exception):
    pass
ANOMALY_REVIEW_ACTIONS = {
    "mark_reviewed": {"status": "reviewed", "verb": "Marked as reviewed"},
    "mark_false_positive": {"status": "false_positive", "verb": "Marked as false positive"},
    "mark_confirmed": {"status": "confirmed", "verb": "Marked as confirmed"},
    "mark_investigating": {"status": "investigating", "verb": "Marked as investigating"},
    "mark_resolved": {"status": "resolved", "verb": "Marked as resolved"},
    "propose_edit": {"status": "investigating", "verb": "Proposed data edit"},
    "quarantine_record": {"status": "investigating", "verb": "Proposed quarantine"},
    "exclude_from_analytics": {"status": "reviewed", "verb": "Excluded from analytics"},
    "soft_drop_record": {"status": "investigating", "verb": "Proposed soft drop"},
    "drop_record": {"status": "investigating", "verb": "Proposed soft drop"},
}


def _cors_headers() -> Dict[str, str]:
    return {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
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


def _normalize_company_id(value: Any) -> str:
    company_id = str(value or "").strip().lower()
    if not COMPANY_ID_PATTERN.match(company_id):
        raise ValueError("Invalid company identifier.")
    return company_id


def _normalize_role(value: Any, *, fallback: str = DEFAULT_ACCOUNT_ROLE) -> str:
    role = str(value or "").strip().lower()
    if not role:
        role = fallback
    if role not in ALLOWED_ACCOUNT_ROLES:
        role = fallback
    return role


def _is_active_status(value: Any) -> bool:
    normalized = str(value or "active").strip().lower()
    return normalized in ACTIVE_STATUS_VALUES


def _looks_company_scoped_prefix(prefix: str) -> bool:
    # Company table prefixes are server-side config; accept any non-root tenant path under trusted/.
    normalized = _normalize_prefix(prefix, TRUSTED_ROOT_PREFIX)
    if not normalized.startswith(TRUSTED_ROOT_PREFIX):
        return False
    return bool(normalized[len(TRUSTED_ROOT_PREFIX):].strip("/"))


def _looks_company_scoped_analytics_prefix(prefix: str) -> bool:
    # Analytics prefixes follow the same pattern and may include env-specific deployment suffixes.
    normalized = _normalize_prefix(prefix, TRUSTED_ANALYTICS_ROOT_PREFIX)
    if not normalized.startswith(TRUSTED_ANALYTICS_ROOT_PREFIX):
        return False
    return bool(normalized[len(TRUSTED_ANALYTICS_ROOT_PREFIX):].strip("/"))


def _company_prefixes(company_id: str, company: Optional[Dict[str, Any]]) -> Dict[str, str]:
    trusted_base_default = f"{TRUSTED_ROOT_PREFIX}{company_id}/"
    analytics_base_default = f"{TRUSTED_ANALYTICS_ROOT_PREFIX}{company_id}/"

    trusted_base = _normalize_prefix(
        (company or {}).get("trusted_prefix") if _looks_company_scoped_prefix(str((company or {}).get("trusted_prefix") or "")) else trusted_base_default,
        trusted_base_default,
    )
    analytics_base = _normalize_prefix(
        (company or {}).get("analytics_prefix")
        if _looks_company_scoped_analytics_prefix(str((company or {}).get("analytics_prefix") or ""))
        else analytics_base_default,
        analytics_base_default,
    )

    return {
        "trusted_base": trusted_base,
        "analytics_base": analytics_base,
        "employees": f"{trusted_base}employees/",
        "finance": f"{trusted_base}finance/transactions/",
        "predictions": f"{analytics_base}predictions/",
        "anomalies": f"{analytics_base}anomalies/",
    }


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


def _load_latest_prediction(prefix: str) -> Dict[str, Any]:
    latest = _get_latest_object(prefix)
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


def _build_dashboard_payload(auth_context: Dict[str, Any]) -> Dict[str, Any]:
    prefixes = auth_context["prefixes"]

    latest_finance_object = _get_latest_object(prefixes["finance"])
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

    prediction_info = _load_latest_prediction(prefixes["predictions"])
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

    employee_records, employee_keys = _load_records(prefixes["employees"], max_files=12)
    finance_records, finance_keys = _load_records(prefixes["finance"], max_files=12)

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
            "company_id": auth_context.get("company_id"),
            "trusted_prefix": prefixes["trusted_base"],
        },
    }

    return dashboard


def _forecast_payload(auth_context: Dict[str, Any]) -> Dict[str, Any]:
    prediction_info = _load_latest_prediction(auth_context["prefixes"]["predictions"])
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
        "company_id": auth_context.get("company_id"),
    }


def _normalize_anomaly_item(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None
    anomaly_id = str(item.get("anomaly_id") or "").strip()
    if not anomaly_id:
        return None

    normalized = dict(item)
    normalized["anomaly_id"] = anomaly_id
    normalized["record_ids"] = [str(value) for value in (item.get("record_ids") or []) if str(value).strip()]
    normalized["reasons"] = [str(value) for value in (item.get("reasons") or []) if str(value).strip()]
    normalized["audit_trail"] = list(item.get("audit_trail") or [])
    normalized["status"] = str(item.get("status") or "new")
    normalized["severity"] = str(item.get("severity") or "low")
    normalized["anomaly_type"] = str(item.get("anomaly_type") or "unknown")
    normalized["entity_type"] = str(item.get("entity_type") or "unknown")
    normalized["detected_at"] = str(item.get("detected_at") or "")
    if "metrics" not in normalized or not isinstance(normalized["metrics"], dict):
        normalized["metrics"] = {}
    return normalized


def _load_latest_anomalies(prefix: str) -> Dict[str, Any]:
    latest = _get_latest_object(prefix)
    if latest is None:
        return {
            "found": False,
            "generated_at": None,
            "key": None,
            "last_modified": None,
            "items": [],
            "summary": {},
        }

    key = latest["Key"]
    try:
        payload = _read_object_text(key)
        parsed = json.loads(payload)
        if not isinstance(parsed, dict):
            raise ValueError("Anomaly payload must be a JSON object.")
        items = [_normalize_anomaly_item(item) for item in (parsed.get("anomalies") or [])]
        normalized_items = [item for item in items if item is not None]
        return {
            "found": True,
            "generated_at": parsed.get("generated_at"),
            "key": key,
            "last_modified": latest["LastModified"].isoformat(),
            "items": normalized_items,
            "summary": parsed.get("summary") or {},
        }
    except Exception as exc:
        return {
            "found": True,
            "generated_at": None,
            "key": key,
            "last_modified": latest["LastModified"].isoformat(),
            "items": [],
            "summary": {},
            "error": str(exc),
        }


def _review_partition_key(company_id: str, anomaly_id: str) -> str:
    return f"{company_id}#{anomaly_id}"


def _get_review_item(company_id: str, anomaly_id: str) -> Dict[str, Any]:
    response = anomaly_reviews_table.get_item(Key={"anomaly_id": _review_partition_key(company_id, anomaly_id)})
    item = response.get("Item")
    return item if isinstance(item, dict) else {}


def _merge_anomaly_with_review(anomaly: Dict[str, Any], review_item: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(anomaly)
    if not review_item:
        return merged

    status = str(review_item.get("status") or merged.get("status") or "new")
    merged["status"] = status
    merged["audit_trail"] = list(review_item.get("audit_trail") or merged.get("audit_trail") or [])
    merged["review"] = {
        "last_action": review_item.get("last_action"),
        "updated_at": review_item.get("updated_at"),
        "updated_by": review_item.get("updated_by"),
        "notes": list(review_item.get("notes") or []),
    }
    return merged


def _load_anomalies_with_reviews(auth_context: Dict[str, Any]) -> Dict[str, Any]:
    source = _load_latest_anomalies(auth_context["prefixes"]["anomalies"])
    merged_items: List[Dict[str, Any]] = []
    for anomaly in source.get("items", []):
        anomaly_id = str(anomaly.get("anomaly_id") or "")
        if not anomaly_id:
            continue
        review_item = _get_review_item(auth_context["company_id"], anomaly_id)
        merged_items.append(_merge_anomaly_with_review(anomaly, review_item))

    source["items"] = sorted(
        merged_items,
        key=lambda item: _parse_datetime(item.get("detected_at")) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    return source


def _query_set(query: Dict[str, Any], name: str) -> set[str]:
    raw = query.get(name)
    if raw is None:
        return set()
    values = [part.strip().lower() for part in str(raw).split(",")]
    return {value for value in values if value}


def _query_date(query: Dict[str, Any], name: str) -> Optional[datetime]:
    raw = query.get(name)
    if raw is None:
        return None
    return _parse_datetime(raw)


def _filter_anomalies(items: Iterable[Dict[str, Any]], query: Dict[str, Any]) -> List[Dict[str, Any]]:
    anomaly_types = _query_set(query, "anomaly_type")
    severities = _query_set(query, "severity")
    statuses = _query_set(query, "status")
    entity_types = _query_set(query, "entity_type")
    date_from = _query_date(query, "date_from")
    date_to = _query_date(query, "date_to")

    filtered: List[Dict[str, Any]] = []
    for item in items:
        anomaly_type = str(item.get("anomaly_type") or "").lower()
        severity = str(item.get("severity") or "").lower()
        status = str(item.get("status") or "").lower()
        entity_type = str(item.get("entity_type") or "").lower()
        detected_at = _parse_datetime(item.get("detected_at"))

        if anomaly_types and anomaly_type not in anomaly_types:
            continue
        if severities and severity not in severities:
            continue
        if statuses and status not in statuses:
            continue
        if entity_types and entity_type not in entity_types:
            continue
        if date_from and detected_at and detected_at < date_from:
            continue
        if date_to and detected_at and detected_at > date_to:
            continue
        filtered.append(item)
    return filtered


def _anomaly_summary(items: Sequence[Dict[str, Any]]) -> Dict[str, int]:
    status_values = [str(item.get("status") or "new").lower() for item in items]
    reviewed_statuses = {"reviewed", "confirmed", "false_positive", "resolved"}
    return {
        "high_priority_count": sum(1 for item in items if str(item.get("severity") or "").lower() == "high"),
        "medium_priority_count": sum(1 for item in items if str(item.get("severity") or "").lower() == "medium"),
        "low_priority_count": sum(1 for item in items if str(item.get("severity") or "").lower() == "low"),
        "reviewed_count": sum(1 for status in status_values if status in reviewed_statuses),
        "confirmed_count": sum(1 for status in status_values if status == "confirmed"),
    }


def _anomaly_path_parts(path: str) -> Tuple[Optional[str], bool]:
    if path.startswith("/anomalies/") and path.endswith("/actions"):
        anomaly_id = path[len("/anomalies/") : -len("/actions")].strip("/")
        return (unquote(anomaly_id), True) if anomaly_id else (None, True)
    if path.startswith("/anomalies/"):
        anomaly_id = path[len("/anomalies/") :].strip("/")
        return (unquote(anomaly_id), False) if anomaly_id else (None, False)
    return None, False


def _build_anomaly_list_payload(event: Dict[str, Any], auth_context: Dict[str, Any]) -> Dict[str, Any]:
    limit = _parse_limit(event)
    query = event.get("queryStringParameters") or {}
    source = _load_anomalies_with_reviews(auth_context)
    filtered = _filter_anomalies(source.get("items", []), query)

    return {
        "items": filtered[:limit],
        "summary": _anomaly_summary(filtered),
        "generated_at": source.get("generated_at"),
        "s3_key": source.get("key"),
        "last_modified": source.get("last_modified"),
        "error": source.get("error"),
        "company_id": auth_context.get("company_id"),
    }


def _find_anomaly_by_id(auth_context: Dict[str, Any], anomaly_id: str) -> Optional[Dict[str, Any]]:
    source = _load_anomalies_with_reviews(auth_context)
    for item in source.get("items", []):
        if str(item.get("anomaly_id")) == anomaly_id:
            return item
    return None


def _build_anomaly_detail_payload(auth_context: Dict[str, Any], anomaly_id: str) -> Optional[Dict[str, Any]]:
    anomaly = _find_anomaly_by_id(auth_context, anomaly_id)
    if anomaly is None:
        return None
    return {"item": anomaly, "company_id": auth_context.get("company_id")}


def _normalize_review_action(action: str) -> str:
    normalized = action.strip().lower().replace("-", "_").replace(" ", "_")
    if normalized == "mark_as_reviewed":
        return "mark_reviewed"
    if normalized == "mark_as_false_positive":
        return "mark_false_positive"
    if normalized == "mark_as_confirmed":
        return "mark_confirmed"
    if normalized == "quarantine":
        return "quarantine_record"
    if normalized in {"soft_drop", "drop", "drop_from_analytics"}:
        return "soft_drop_record"
    return normalized


def _validated_status(status: str) -> str:
    normalized = status.strip().lower()
    if normalized not in ANOMALY_STATUS_VALUES:
        raise ValueError(f"Invalid anomaly status: {status}")
    return normalized


def _update_anomaly_review(event: Dict[str, Any], auth_context: Dict[str, Any], anomaly_id: str) -> Dict[str, Any]:
    body = _parse_json_body(event)
    action = _normalize_review_action(str(body.get("action") or "mark_reviewed"))
    action_definition = ANOMALY_REVIEW_ACTIONS.get(action)
    if action_definition is None:
        raise ValueError("Unsupported review action.")

    claims = auth_context["claims"]
    company_id = auth_context["company_id"]
    actor_email = str(claims.get("sub") or "unknown")
    actor_name = str(claims.get("name") or "")
    actor = actor_name if actor_name else actor_email
    now_iso = datetime.now(timezone.utc).isoformat()
    note_text = str(body.get("note") or "").strip()

    status_override = str(body.get("status") or "").strip()
    status = action_definition["status"]
    if status_override:
        status = _validated_status(status_override)

    review_item = _get_review_item(company_id, anomaly_id) or {"audit_trail": [], "notes": []}
    audit_trail = list(review_item.get("audit_trail") or [])
    notes = list(review_item.get("notes") or [])

    audit_entry = {
        "at": now_iso,
        "actor": actor,
        "action": action,
        "status": status,
        "message": action_definition["verb"],
    }
    if note_text:
        audit_entry["note"] = note_text
        notes.append({"at": now_iso, "author": actor, "note": note_text, "action": action})

    audit_trail.append(audit_entry)
    review_key = _review_partition_key(company_id, anomaly_id)
    updated_item = {
        "anomaly_id": review_key,
        "company_id": company_id,
        "source_anomaly_id": anomaly_id,
        "status": status,
        "last_action": action,
        "updated_at": now_iso,
        "updated_by": actor,
        "notes": notes[-50:],
        "audit_trail": audit_trail[-100:],
    }

    anomaly_reviews_table.put_item(Item=updated_item)

    anomaly = _find_anomaly_by_id(auth_context, anomaly_id)
    if anomaly is None:
        anomaly = {
            "anomaly_id": anomaly_id,
            "entity_type": "unknown",
            "record_ids": [],
            "anomaly_type": "unknown",
            "severity": "low",
            "confidence": 0.0,
            "title": "Anomaly record not found in latest batch",
            "description": "Review action stored, but the anomaly is not present in the current source file.",
            "reasons": [],
            "status": status,
            "suggested_action": "review",
            "metrics": {},
            "detected_at": now_iso,
            "source_table": "unknown",
            "audit_trail": [],
        }

    return {"item": _merge_anomaly_with_review(anomaly, updated_item), "company_id": company_id}


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
        raise ValueError("Only read-only SELECT queries are allowed.")

    if UNSAFE_SQL_PATTERN.search(cleaned):
        raise ValueError("Query contains unsupported SQL constructs.")

    lowered = cleaned.lower().strip()
    if not lowered.startswith("select"):
        raise ValueError("Query must start with SELECT.")
    if lowered.count("select") > 1:
        raise ValueError("Subqueries are not supported on this endpoint.")

    return cleaned


def _enforce_limit(sql: str, limit: int) -> str:
    safe_limit = max(1, min(limit, QUERY_MAX_ROWS))
    match = re.search(r"\blimit\s+(\d+)\s*$", sql, re.IGNORECASE)
    if not match:
        return f"{sql} LIMIT {safe_limit}"

    existing = int(match.group(1))
    bounded = min(existing, safe_limit)
    return re.sub(r"\blimit\s+\d+\s*$", f"LIMIT {bounded}", sql, count=1, flags=re.IGNORECASE)


def _normalize_s3_location(location: str) -> str:
    value = str(location or "").strip()
    if not value:
        return ""
    return value if value.endswith("/") else f"{value}/"


def _quote_sql_identifier(identifier: str) -> str:
    cleaned = str(identifier or "").strip()
    if not cleaned:
        raise ValueError("Query table name is not configured.")
    return f"\"{cleaned.replace('\"', '\"\"')}\""


def _list_glue_tables(database_name: str) -> List[Dict[str, Any]]:
    tables: List[Dict[str, Any]] = []
    next_token: Optional[str] = None

    while True:
        kwargs: Dict[str, Any] = {"DatabaseName": database_name}
        if next_token:
            kwargs["NextToken"] = next_token
        response = glue_client.get_tables(**kwargs)
        tables.extend(response.get("TableList") or [])
        next_token = response.get("NextToken")
        if not next_token:
            return tables


@lru_cache(maxsize=128)
def _resolve_trusted_query_target(database_name: str, bucket_name: str, trusted_base_prefix: str) -> Tuple[str, Optional[str]]:
    target_location = _normalize_s3_location(f"s3://{bucket_name}/{trusted_base_prefix}")
    root_location = _normalize_s3_location(f"s3://{bucket_name}/{TRUSTED_ROOT_PREFIX}")
    root_table_name: Optional[str] = None

    for table in _list_glue_tables(database_name):
        table_name = str(table.get("Name") or "").strip()
        storage = table.get("StorageDescriptor") or {}
        location = _normalize_s3_location(storage.get("Location") or "")
        if not table_name or not location:
            continue
        if location == target_location:
            return table_name, None
        if table_name.lower() == "trusted" and location == root_location:
            root_table_name = table_name

    if root_table_name:
        path_filter = trusted_base_prefix.strip("/")
        if not path_filter:
            raise ValueError("Company data prefix is not configured.")
        return root_table_name, f"\"$path\" LIKE '%/{path_filter}/%'"

    raise ValueError("Tenant query table is not available. Run the trusted Glue crawler and try again.")


def _build_tenant_scoped_sql(sql: str, resolved_table_name: str, scope_predicate: Optional[str] = None) -> str:
    parsed = SIMPLE_TRUSTED_SQL_PATTERN.match(sql)
    if not parsed:
        raise ValueError("Only simple SELECT queries against the trusted table are supported.")

    table_name = str(parsed.group("table") or "").replace('"', "").strip().lower()
    if table_name != "trusted":
        raise ValueError("Queries must read from the trusted table.")

    select_clause = str(parsed.group("select") or "").strip()
    where_clause = str(parsed.group("where") or "").strip()
    order_clause = str(parsed.group("order") or "").strip()

    if not select_clause:
        raise ValueError("Query projection is required.")

    query_table = _quote_sql_identifier(resolved_table_name)

    if where_clause and scope_predicate:
        scoped_where = f"({where_clause}) AND {scope_predicate}"
    elif where_clause:
        scoped_where = where_clause
    else:
        scoped_where = scope_predicate or ""

    scoped_sql = f"SELECT {select_clause} FROM {query_table}"
    if scoped_where:
        scoped_sql = f"{scoped_sql} WHERE {scoped_where}"
    if order_clause:
        scoped_sql = f"{scoped_sql} ORDER BY {order_clause}"
    return scoped_sql


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


def _run_query(event: Dict[str, Any], auth_context: Dict[str, Any]) -> Dict[str, Any]:
    company = auth_context["company"]
    athena_database = str(company.get("athena_database") or ATHENA_DATABASE).strip()

    if not ATHENA_WORKGROUP or not athena_database:
        raise ValueError("Athena query endpoint is not configured (missing workgroup/database).")

    body = _parse_json_body(event)
    sql = _normalize_sql(str(body.get("query", "")))
    limit = int(body.get("limit", QUERY_MAX_ROWS) or QUERY_MAX_ROWS)
    limit = max(1, min(limit, QUERY_MAX_ROWS))

    query_table_name, scope_predicate = _resolve_trusted_query_target(
        athena_database,
        DATA_LAKE_BUCKET,
        auth_context["prefixes"]["trusted_base"],
    )
    scoped_sql = _build_tenant_scoped_sql(sql, query_table_name, scope_predicate)
    query_text = _enforce_limit(scoped_sql, limit)

    start_kwargs: Dict[str, Any] = {
        "QueryString": query_text,
        "QueryExecutionContext": {"Database": athena_database},
        "WorkGroup": ATHENA_WORKGROUP,
    }
    if ATHENA_OUTPUT_LOCATION:
        start_kwargs["ResultConfiguration"] = {"OutputLocation": ATHENA_OUTPUT_LOCATION}

    start = athena_client.start_query_execution(**start_kwargs)
    query_execution_id = start["QueryExecutionId"]

    execution = _await_athena(query_execution_id)
    status = execution["QueryExecution"]["Status"]["State"]
    if status != "SUCCEEDED":
        reason = execution["QueryExecution"]["Status"].get("StateChangeReason", "Query failed.")
        raise RuntimeError(reason)

    columns, rows = _fetch_athena_rows(query_execution_id, max_rows=limit)
    return {
        "query_execution_id": query_execution_id,
        "query_table": query_table_name,
        "columns": columns,
        "rows": rows,
        "row_count": len(rows),
        "company_id": auth_context.get("company_id"),
    }


def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("utf-8").rstrip("=")


def _base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _hash_password(password: str, salt_hex: Optional[str] = None) -> Tuple[str, str]:
    salt = bytes.fromhex(salt_hex) if salt_hex else secrets.token_bytes(16)
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120_000)
    return salt.hex(), hashed.hex()


def _validate_email(email: str) -> str:
    normalized = email.strip().lower()
    if not EMAIL_PATTERN.match(normalized):
        raise ValueError("Please provide a valid email address.")
    return normalized


def _validate_password(password: str) -> str:
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters long.")
    return password


def _sign_token_segment(segment: str) -> str:
    signature = hmac.new(AUTH_TOKEN_SECRET.encode("utf-8"), segment.encode("utf-8"), hashlib.sha256).digest()
    return _base64url_encode(signature)


def _issue_token(account: Dict[str, Any]) -> str:
    now = int(time.time())
    email = str(account.get("email") or "").strip().lower()
    display_name = str(account.get("display_name") or "")
    company_id = str(account.get("company_id") or "").strip().lower()
    role = _normalize_role(account.get("role"), fallback=DEFAULT_ACCOUNT_ROLE)

    payload = {
        "sub": email,
        "name": display_name,
        "company_id": company_id,
        "role": role,
        "iat": now,
        "exp": now + AUTH_TOKEN_TTL_SECONDS,
    }
    payload_segment = _base64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature_segment = _sign_token_segment(payload_segment)
    return f"{payload_segment}.{signature_segment}"


def _verify_token(token: str) -> Dict[str, Any]:
    if "." not in token:
        raise ValueError("Invalid auth token.")

    payload_segment, signature_segment = token.split(".", 1)
    expected_signature = _sign_token_segment(payload_segment)
    if not hmac.compare_digest(signature_segment, expected_signature):
        raise ValueError("Invalid auth token signature.")

    try:
        payload = json.loads(_base64url_decode(payload_segment).decode("utf-8"))
    except Exception as exc:
        raise ValueError("Invalid auth token payload.") from exc

    if int(payload.get("exp", 0)) < int(time.time()):
        raise ValueError("Auth token expired.")

    return payload


def _get_header(event: Dict[str, Any], header_name: str) -> Optional[str]:
    headers = event.get("headers") or {}
    target = header_name.lower()
    for key, value in headers.items():
        if str(key).lower() == target:
            return value
    return None


def _require_auth(event: Dict[str, Any]) -> Dict[str, Any]:
    auth_header = _get_header(event, "Authorization")
    if not auth_header:
        raise PermissionError("Missing Authorization header.")

    parts = auth_header.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise PermissionError("Authorization header must be Bearer token.")

    token = parts[1].strip()
    if not token:
        raise PermissionError("Missing bearer token.")

    try:
        return _verify_token(token)
    except ValueError as exc:
        raise PermissionError(str(exc)) from exc


def _sanitize_account(item: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "user_id": item.get("user_id"),
        "email": item.get("email"),
        "display_name": item.get("display_name") or "",
        "company_id": item.get("company_id"),
        "role": _normalize_role(item.get("role"), fallback=DEFAULT_ACCOUNT_ROLE),
        "status": str(item.get("status") or "active"),
        "created_at": item.get("created_at"),
    }


def _sanitize_company(item: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "company_id": item.get("company_id"),
        "company_name": item.get("company_name") or "",
        "status": item.get("status") or "inactive",
        "trusted_prefix": item.get("trusted_prefix"),
        "analytics_prefix": item.get("analytics_prefix"),
        "athena_database": item.get("athena_database"),
    }


def _get_account(email: str) -> Optional[Dict[str, Any]]:
    response = accounts_table.get_item(Key={"email": email})
    item = response.get("Item")
    return item if isinstance(item, dict) else None


def _get_company(company_id: str) -> Optional[Dict[str, Any]]:
    response = companies_table.get_item(Key={"company_id": company_id})
    item = response.get("Item")
    return item if isinstance(item, dict) else None


def _get_invite(invite_code: str) -> Optional[Dict[str, Any]]:
    response = invites_table.get_item(Key={"invite_code": invite_code})
    item = response.get("Item")
    return item if isinstance(item, dict) else None


def _parse_expiration_epoch(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    parsed = _parse_datetime(value)
    if parsed is None:
        return None
    return int(parsed.timestamp())


def _is_invite_used(invite: Dict[str, Any]) -> bool:
    raw = invite.get("used")
    if isinstance(raw, bool):
        return raw
    return str(raw or "").strip().lower() in {"1", "true", "yes"}


def _is_invite_expired(invite: Dict[str, Any], now_ts: int) -> bool:
    expiry = _parse_expiration_epoch(invite.get("expires_at"))
    if expiry is None:
        return False
    return expiry < now_ts


def _require_active_company(company_id: str) -> Dict[str, Any]:
    company = _get_company(company_id)
    if not company:
        raise ForbiddenError("Company not found.")
    if not _is_active_status(company.get("status")):
        raise ForbiddenError("Company is inactive.")
    return company


def _build_auth_context(event: Dict[str, Any]) -> Dict[str, Any]:
    claims = _require_auth(event)
    email = _validate_email(str(claims.get("sub") or ""))
    account = _get_account(email)
    if not account:
        raise PermissionError("Account not found.")

    account_status = str(account.get("status") or "active").strip().lower()
    if not _is_active_status(account_status):
        raise ForbiddenError("Account is inactive.")

    account_company_raw = str(account.get("company_id") or "").strip()
    if not account_company_raw:
        raise ForbiddenError("Account is missing company assignment. Migration required.")
    account_company_id = _normalize_company_id(account_company_raw)

    token_company_raw = str(claims.get("company_id") or "").strip().lower()
    if token_company_raw and token_company_raw != account_company_id:
        raise PermissionError("Auth token is stale. Please sign in again.")

    account_role = _normalize_role(account.get("role"), fallback=DEFAULT_ACCOUNT_ROLE)
    token_role = str(claims.get("role") or "").strip().lower()
    if token_role and token_role != account_role:
        raise PermissionError("Auth token is stale. Please sign in again.")

    company = _require_active_company(account_company_id)
    prefixes = _company_prefixes(account_company_id, company)

    return {
        "claims": claims,
        "account": account,
        "company": company,
        "company_id": account_company_id,
        "role": account_role,
        "prefixes": prefixes,
    }


def _validate_invite_code(value: Any) -> str:
    invite_code = str(value or "").strip()
    if len(invite_code) < 8:
        raise ValueError("A valid invite code is required.")
    if len(invite_code) > 128:
        raise ValueError("Invite code is invalid.")
    return invite_code


def _mark_invite_as_used(invite_code: str, used_by_email: str, now_iso: str, now_ts: int) -> None:
    invites_table.update_item(
        Key={"invite_code": invite_code},
        UpdateExpression="SET used = :used, used_by = :used_by, used_at = :used_at",
        ConditionExpression=(
            "attribute_exists(invite_code) "
            "AND (attribute_not_exists(used) OR used = :unused) "
            "AND (attribute_not_exists(expires_at) OR expires_at >= :now_ts)"
        ),
        ExpressionAttributeValues={
            ":used": True,
            ":unused": False,
            ":used_by": used_by_email,
            ":used_at": now_iso,
            ":now_ts": now_ts,
        },
    )


def _delete_account_best_effort(email: str) -> None:
    try:
        accounts_table.delete_item(Key={"email": email})
    except Exception:
        pass


def _handle_signup(event: Dict[str, Any]) -> Dict[str, Any]:
    body = _parse_json_body(event)
    email = _validate_email(str(body.get("email", "")))
    password = _validate_password(str(body.get("password", "")))
    display_name = str(body.get("display_name") or "").strip()
    invite_code = _validate_invite_code(body.get("invite_code"))
    now_ts = int(time.time())
    now_iso = datetime.now(timezone.utc).isoformat()

    if _get_account(email):
        return _response(409, {"message": "An account with that email already exists."})

    invite = _get_invite(invite_code)
    if not invite:
        return _response(400, {"message": "Invite code is invalid or expired."})
    if _is_invite_used(invite) or _is_invite_expired(invite, now_ts):
        return _response(400, {"message": "Invite code is invalid or expired."})

    invite_company_raw = str(invite.get("company_id") or "").strip()
    if not invite_company_raw:
        return _response(400, {"message": "Invite is not linked to a company."})

    try:
        company_id = _normalize_company_id(invite_company_raw)
    except ValueError:
        return _response(400, {"message": "Invite is not linked to a valid company."})

    try:
        _require_active_company(company_id)
    except ForbiddenError as exc:
        return _response(403, {"message": str(exc)})

    role = _normalize_role(invite.get("role"), fallback=DEFAULT_ACCOUNT_ROLE)
    salt_hex, hash_hex = _hash_password(password)
    item = {
        "user_id": uuid4().hex,
        "email": email,
        "display_name": display_name,
        "password_salt": salt_hex,
        "password_hash": hash_hex,
        "company_id": company_id,
        "role": role,
        "status": "active",
        "invite_code_used": invite_code,
        "created_at": now_iso,
        "updated_at": now_iso,
    }

    try:
        accounts_table.put_item(Item=item, ConditionExpression="attribute_not_exists(email)")
    except Exception as exc:
        message = str(exc)
        if "ConditionalCheckFailed" in message:
            return _response(409, {"message": "An account with that email already exists."})
        raise

    try:
        _mark_invite_as_used(invite_code, email, now_iso, now_ts)
    except Exception as exc:
        _delete_account_best_effort(email)
        message = str(exc)
        if "ConditionalCheckFailed" in message:
            return _response(400, {"message": "Invite code is invalid or expired."})
        raise

    token = _issue_token(item)
    return _response(201, {"token": token, "user": _sanitize_account(item)})


def _handle_login(event: Dict[str, Any]) -> Dict[str, Any]:
    body = _parse_json_body(event)
    email = _validate_email(str(body.get("email", "")))
    password = str(body.get("password", ""))

    account = _get_account(email)
    if not account:
        return _response(401, {"message": "Invalid email or password."})

    salt_hex = str(account.get("password_salt") or "")
    stored_hash = str(account.get("password_hash") or "")
    if not salt_hex or not stored_hash:
        return _response(401, {"message": "Invalid email or password."})

    _, computed_hash = _hash_password(password, salt_hex=salt_hex)
    if not hmac.compare_digest(stored_hash, computed_hash):
        return _response(401, {"message": "Invalid email or password."})

    company_raw = str(account.get("company_id") or "").strip()
    if not company_raw:
        return _response(403, {"message": "Account is missing company assignment. Migration required."})

    try:
        company_id = _normalize_company_id(company_raw)
    except ValueError:
        return _response(403, {"message": "Account company assignment is invalid."})

    if not _is_active_status(account.get("status")):
        return _response(403, {"message": "Account is inactive."})

    try:
        _require_active_company(company_id)
    except ForbiddenError as exc:
        return _response(403, {"message": str(exc)})

    token = _issue_token(account)
    return _response(200, {"token": token, "user": _sanitize_account(account)})


def _parse_invite_expiry(payload: Dict[str, Any], now_ts: int) -> int:
    expires_at = payload.get("expires_at")
    expires_in_days = payload.get("expires_in_days")

    if expires_at is not None:
        parsed = _parse_expiration_epoch(expires_at)
        if parsed is None:
            raise ValueError("expires_at must be a valid ISO datetime or unix timestamp.")
        if parsed <= now_ts:
            raise ValueError("expires_at must be in the future.")
        return parsed

    days = 14
    if expires_in_days is not None:
        days = int(expires_in_days)
    days = max(1, min(days, 90))
    return now_ts + (days * 24 * 60 * 60)


def _generate_invite_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(12))


def _create_invite_record(company_id: str, role: str, expires_at: int, created_by: str, now_iso: str) -> Dict[str, Any]:
    for _ in range(8):
        invite_code = _generate_invite_code()
        item = {
            "invite_code": invite_code,
            "company_id": company_id,
            "role": role,
            "expires_at": expires_at,
            "used": False,
            "used_by": None,
            "used_at": None,
            "created_at": now_iso,
            "created_by": created_by,
        }
        try:
            invites_table.put_item(Item=item, ConditionExpression="attribute_not_exists(invite_code)")
            return item
        except Exception as exc:
            if "ConditionalCheckFailed" in str(exc):
                continue
            raise
    raise RuntimeError("Could not generate a unique invite code.")


def _handle_admin_create_invite(event: Dict[str, Any], auth_context: Dict[str, Any]) -> Dict[str, Any]:
    if auth_context.get("role") != "admin":
        raise ForbiddenError("Admin role required.")

    payload = _parse_json_body(event)
    requested_role = _normalize_role(payload.get("role"), fallback=DEFAULT_ACCOUNT_ROLE)
    now_ts = int(time.time())
    now_iso = datetime.now(timezone.utc).isoformat()
    expires_at = _parse_invite_expiry(payload, now_ts)

    created = _create_invite_record(
        auth_context["company_id"],
        requested_role,
        expires_at,
        str(auth_context["account"].get("email") or ""),
        now_iso,
    )
    return _response(
        201,
        {
            "invite": {
                "invite_code": created["invite_code"],
                "company_id": created["company_id"],
                "role": created["role"],
                "expires_at": created["expires_at"],
                "used": created["used"],
                "created_at": created["created_at"],
            }
        },
    )


def _handle_auth_me(auth_context: Dict[str, Any]) -> Dict[str, Any]:
    return _response(
        200,
        {
            "user": _sanitize_account(auth_context["account"]),
            "company": _sanitize_company(auth_context["company"]),
        },
    )


def _handle_latest(event: Dict[str, Any], auth_context: Dict[str, Any]) -> Dict[str, Any]:
    limit = _parse_limit(event)
    latest = _get_latest_object(auth_context["prefixes"]["finance"])

    if latest is None:
        return _response(200, {"items": [], "s3_key": None, "last_modified": None, "company_id": auth_context["company_id"]})

    decoded_text = _read_object_text(latest["Key"])
    items = _parse_items(decoded_text)

    return _response(
        200,
        {
            "items": items[-limit:],
            "s3_key": latest["Key"],
            "last_modified": latest["LastModified"].isoformat(),
            "company_id": auth_context["company_id"],
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
        if path == "/auth/signup":
            if method != "POST":
                return _response(405, {"message": "Method not allowed"})
            return _handle_signup(event)

        if path == "/auth/login":
            if method != "POST":
                return _response(405, {"message": "Method not allowed"})
            return _handle_login(event)

        if path == "/auth/me":
            if method != "GET":
                return _response(405, {"message": "Method not allowed"})
            auth_context = _build_auth_context(event)
            return _handle_auth_me(auth_context)

        auth_context = _build_auth_context(event)

        if path == "/admin/invites":
            if method != "POST":
                return _response(405, {"message": "Method not allowed"})
            return _handle_admin_create_invite(event, auth_context)

        if path == "/query":
            if method != "POST":
                return _response(405, {"message": "Method not allowed"})
            return _response(200, _run_query(event, auth_context))

        if path == "/anomalies":
            if method != "GET":
                return _response(405, {"message": "Method not allowed"})
            return _response(200, _build_anomaly_list_payload(event, auth_context))

        anomaly_id, is_action_route = _anomaly_path_parts(path)
        if anomaly_id and is_action_route:
            if method != "POST":
                return _response(405, {"message": "Method not allowed"})
            return _response(200, _update_anomaly_review(event, auth_context, anomaly_id))
        if anomaly_id:
            if method != "GET":
                return _response(405, {"message": "Method not allowed"})
            payload = _build_anomaly_detail_payload(auth_context, anomaly_id)
            if payload is None:
                return _response(404, {"message": "Anomaly not found."})
            return _response(200, payload)

        if method != "GET":
            return _response(405, {"message": "Method not allowed"})

        if path in {"/latest", "/"}:
            return _handle_latest(event, auth_context)
        if path == "/dashboard":
            return _response(200, _build_dashboard_payload(auth_context))
        if path == "/forecasts":
            return _response(200, _forecast_payload(auth_context))

        return _response(404, {"message": f"Route not found: {path}"})

    except PermissionError as exc:
        return _response(401, {"message": str(exc)})
    except ForbiddenError as exc:
        return _response(403, {"message": str(exc)})
    except ValueError as exc:
        return _response(400, {"message": str(exc)})
    except TimeoutError as exc:
        return _response(504, {"message": str(exc)})
    except RuntimeError as exc:
        return _response(400, {"message": str(exc)})
    except Exception as exc:
        return _response(500, {"message": f"Internal server error: {exc}"})
