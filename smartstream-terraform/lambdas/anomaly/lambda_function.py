import gzip
import json
import logging
import os
import re
import uuid
from collections import defaultdict
from datetime import date, datetime, timezone
from io import BytesIO
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import boto3
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

# Set up logging, AWS access, and model defaults once per execution environment.
LOGGER = logging.getLogger()
if not LOGGER.handlers:
    logging.basicConfig()
LOGGER.setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())

S3_CLIENT = boto3.client("s3")
SCHEMA_VERSION = "2.0"
MODEL_NAME = "IsolationForest"
MODEL_RANDOM_STATE = 42
MODEL_PARAMS = {
    "n_estimators": 150,
    "contamination": 0.08,
    "random_state": MODEL_RANDOM_STATE,
}
TRANSACTION_FEATURE_COLUMNS = [
    "amount",
    "daily_total",
    "transaction_count",
    "rolling_mean_7",
    "rolling_deviation_7",
    "day_of_week",
]
DAILY_FEATURE_COLUMNS = [
    "daily_total",
    "transaction_count",
    "rolling_mean_7",
    "rolling_deviation_7",
    "day_of_week",
]
MIN_TRANSACTION_ROWS = 20
MIN_DAILY_ROWS = 14
MAX_ANOMALIES = 200


# Normalize environment-driven prefixes and numeric settings before the handler starts
# touching S3 or training the model.
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


# Read dataset locations and feature-related settings once at cold start.
DATA_LAKE_BUCKET = os.environ["DATA_LAKE_BUCKET"]
TRUSTED_PREFIX = _normalize_prefix(os.environ.get("TRUSTED_PREFIX"), "trusted/")
FINANCE_PREFIX = _normalize_prefix(os.environ.get("FINANCE_PREFIX"), f"{TRUSTED_PREFIX}finance/")
TRANSACTIONS_PREFIX = _normalize_prefix(
    os.environ.get("TRANSACTIONS_PREFIX"),
    f"{FINANCE_PREFIX}transactions/",
)
ANALYTICS_PREFIX = _normalize_prefix(
    os.environ.get("ANALYTICS_PREFIX"),
    "trusted-analytics/anomalies/",
)
MAX_INPUT_FILES = _read_int_env("MAX_INPUT_FILES", 20, minimum=1)

DATE_FIELDS = (
    "updated_at",
    "created_at",
    "timestamp",
    "datetime",
    "date",
    "transaction_date",
    "event_time",
    "event_timestamp",
)
TRANSACTION_ID_FIELDS = ("transaction_id", "txn_id", "id", "entry_id")
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


# The handler runs the whole anomaly job in one pass: load recent finance data, score it,
# and publish a single analytics document for downstream APIs.
def lambda_handler(event, context):
    del context
    run_started_at = datetime.now(timezone.utc)
    LOGGER.info(
        (
            "Anomaly detector started at %s "
            "(finance_prefix=%s transactions_prefix=%s analytics_prefix=%s max_input_files=%d)"
        ),
        run_started_at.isoformat(),
        FINANCE_PREFIX,
        TRANSACTIONS_PREFIX,
        ANALYTICS_PREFIX,
        MAX_INPUT_FILES,
    )

    # Prefer the dedicated transactions folder, but fall back to the broader finance folder
    # if that dataset has not been split out yet.
    transaction_objects = list_recent_objects(DATA_LAKE_BUCKET, TRANSACTIONS_PREFIX, MAX_INPUT_FILES)
    fallback_finance_objects = [] if transaction_objects else list_recent_objects(DATA_LAKE_BUCKET, FINANCE_PREFIX, MAX_INPUT_FILES)
    input_objects = transaction_objects or fallback_finance_objects
    records = read_records_from_objects(DATA_LAKE_BUCKET, input_objects)

    # Score the combined finance history and package it into one anomaly payload.
    anomaly_result = detect_finance_anomalies(records, detected_at=run_started_at)
    anomalies = anomaly_result["anomalies"]

    payload = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": run_started_at.isoformat(),
        "status": anomaly_result["status"],
        "summary": {
            "total": len(anomalies),
            "by_severity": summarize_counts(anomalies, "severity"),
            "by_type": summarize_counts(anomalies, "anomaly_type"),
        },
        "source": {
            "bucket": DATA_LAKE_BUCKET,
            "finance_prefix": FINANCE_PREFIX,
            "transactions_prefix": TRANSACTIONS_PREFIX,
            "analytics_prefix": ANALYTICS_PREFIX,
            "input_objects": [obj["Key"] for obj in input_objects],
            "rows_processed": len(records),
            "event_summary": summarize_event(event),
        },
        "metadata": anomaly_result["metadata"],
        "anomalies": anomalies,
    }

    output_key = generate_output_key(run_started_at)
    write_output(payload, output_key)

    return {
        "statusCode": 200,
        "body": json.dumps(
            {
                "status": payload["status"],
                "output_key": output_key,
                "anomaly_count": len(anomalies),
                "summary": payload["summary"],
            }
        ),
    }


# These helpers read recent trusted objects from S3 and turn them into plain record lists
# the model code can work with.
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
            key = str(obj.get("Key") or "")
            if not key or key.endswith("/"):
                continue
            objects.append(
                {
                    "Key": key,
                    "LastModified": obj.get("LastModified"),
                    "Size": obj.get("Size", 0),
                }
            )

    objects.sort(
        key=lambda item: item.get("LastModified") or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    return objects[:limit]


def read_records_from_objects(bucket: str, objects: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    for obj in objects:
        key = str(obj["Key"])
        try:
            payload = read_s3_object_text(bucket, key)
            parsed = parse_records(payload, key)
        except Exception:
            LOGGER.exception("Failed reading/parsing object %s", key)
            continue

        last_modified = obj.get("LastModified")
        for record in parsed:
            enriched = dict(record)
            enriched["_source_key"] = key
            if isinstance(last_modified, datetime):
                enriched["_source_last_modified"] = last_modified.isoformat()
            records.append(enriched)

    return records


def read_s3_object_text(bucket: str, key: str) -> str:
    response = S3_CLIENT.get_object(Bucket=bucket, Key=key)
    raw_bytes = response["Body"].read()
    if key.endswith(".gz"):
        with gzip.GzipFile(fileobj=BytesIO(raw_bytes)) as stream:
            return stream.read().decode("utf-8")
    return raw_bytes.decode("utf-8")


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
            LOGGER.debug("Falling back to JSON-lines parser for %s", source_key)

    records: List[Dict[str, Any]] = []
    for line in raw_text.splitlines():
        text = line.strip()
        if not text:
            continue
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            records.append(parsed)
    return records


# The next group prepares finance rows, builds model features, and chooses the safest
# scoring strategy based on how much history is available.
def detect_finance_anomalies(records: Sequence[Dict[str, Any]], detected_at: datetime) -> Dict[str, Any]:
    rows = normalize_finance_rows(records)
    if not rows:
        return {
            "status": "insufficient_data",
            "anomalies": [],
            "metadata": serialize_anomaly_metadata(
                mode="none",
                feature_columns=[],
                rows_modeled=0,
                records_read=len(records),
                message="No usable finance timestamps and amounts were available.",
            ),
        }

    transaction_frame = build_anomaly_frame(rows, mode="transaction")
    if len(transaction_frame) >= MIN_TRANSACTION_ROWS:
        scored = score_anomalies(
            frame=transaction_frame,
            feature_columns=TRANSACTION_FEATURE_COLUMNS,
            minimum_rows=MIN_TRANSACTION_ROWS,
            mode="transaction",
            detected_at=detected_at,
        )
        if scored["status"] != "insufficient_data":
            return scored

    daily_frame = build_anomaly_frame(rows, mode="daily")
    if len(daily_frame) >= MIN_DAILY_ROWS:
        return score_anomalies(
            frame=daily_frame,
            feature_columns=DAILY_FEATURE_COLUMNS,
            minimum_rows=MIN_DAILY_ROWS,
            mode="daily",
            detected_at=detected_at,
        )

    return {
        "status": "insufficient_data",
        "anomalies": [],
        "metadata": serialize_anomaly_metadata(
            mode="daily" if len(daily_frame) else "transaction",
            feature_columns=DAILY_FEATURE_COLUMNS if len(daily_frame) else TRANSACTION_FEATURE_COLUMNS,
            rows_modeled=int(max(len(transaction_frame), len(daily_frame))),
            records_read=len(records),
            message="Not enough finance history to train IsolationForest safely.",
        ),
    }


def normalize_finance_rows(records: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for index, record in enumerate(records):
        timestamp = extract_record_datetime(record)
        amount = extract_finance_amount(record)
        if timestamp is None or amount is None:
            continue

        record_id = extract_first_string(record, TRANSACTION_ID_FIELDS) or f"finance-{index + 1}"
        source_area = classify_finance_amount(record, amount)
        rows.append(
            {
                "record_id": record_id,
                "timestamp": timestamp,
                "date": timestamp.date(),
                "amount": abs(float(amount)),
                "signed_amount": float(amount),
                "source_area": source_area,
                "raw": record,
            }
        )

    return rows


def build_anomaly_frame(rows: Sequence[Dict[str, Any]], mode: str) -> pd.DataFrame:
    frame = pd.DataFrame(rows)
    if frame.empty:
        return pd.DataFrame()

    frame["date"] = pd.to_datetime(frame["date"])
    frame["day_of_week"] = frame["date"].dt.dayofweek
    frame["amount"] = pd.to_numeric(frame["amount"], errors="coerce")

    daily = (
        frame.groupby(["source_area", "date"], as_index=False)
        .agg(
            daily_total=("amount", "sum"),
            transaction_count=("record_id", "count"),
        )
        .sort_values(["source_area", "date"])
        .reset_index(drop=True)
    )
    daily["rolling_mean_7"] = (
        daily.groupby("source_area")["daily_total"]
        .transform(lambda values: values.shift(1).rolling(window=7, min_periods=3).mean())
    )
    daily["rolling_deviation_7"] = (daily["daily_total"] - daily["rolling_mean_7"]).abs()
    daily["day_of_week"] = daily["date"].dt.dayofweek

    if mode == "daily":
        daily["rolling_mean_7"] = daily["rolling_mean_7"].fillna(daily["daily_total"])
        daily["rolling_deviation_7"] = daily["rolling_deviation_7"].fillna(0.0)
        daily["record_id"] = daily.apply(
            lambda row: f"{row['source_area']}-{pd.Timestamp(row['date']).date().isoformat()}",
            axis=1,
        )
        return daily

    amount_baseline = (
        frame.groupby("source_area")["amount"]
        .transform("median")
        .fillna(frame["amount"])
    )
    merged = frame.merge(
        daily[["source_area", "date", "daily_total", "transaction_count", "rolling_mean_7", "rolling_deviation_7"]],
        on=["source_area", "date"],
        how="left",
    )
    merged["rolling_mean_7"] = merged["rolling_mean_7"].fillna(merged["daily_total"])
    merged["rolling_deviation_7"] = merged["rolling_deviation_7"].fillna(0.0)
    merged["amount_baseline"] = amount_baseline
    return merged


def train_isolation_forest(features: pd.DataFrame) -> IsolationForest:
    model = IsolationForest(**MODEL_PARAMS)
    model.fit(features)
    return model


def score_anomalies(
    *,
    frame: pd.DataFrame,
    feature_columns: Sequence[str],
    minimum_rows: int,
    mode: str,
    detected_at: datetime,
) -> Dict[str, Any]:
    anomalies: List[Dict[str, Any]] = []
    modeled_rows = 0
    scored_groups = 0
    fallback_needed = True

    for source_area, group in frame.groupby("source_area"):
        usable = group.dropna(subset=list(feature_columns)).copy()
        if len(usable) < minimum_rows:
            continue

        fallback_needed = False
        scored_groups += 1
        modeled_rows += len(usable)
        model = train_isolation_forest(usable[list(feature_columns)])
        usable = add_scores(usable, model, feature_columns)
        anomalies.extend(
            build_anomaly_output(
                scored_rows=usable,
                mode=mode,
                detected_at=detected_at,
                feature_columns=feature_columns,
                source_area_override=source_area,
            )
        )

    if fallback_needed:
        usable = frame.dropna(subset=list(feature_columns)).copy()
        if len(usable) >= minimum_rows:
            scored_groups = 1
            modeled_rows = len(usable)
            model = train_isolation_forest(usable[list(feature_columns)])
            usable = add_scores(usable, model, feature_columns)
            anomalies.extend(
                build_anomaly_output(
                    scored_rows=usable,
                    mode=mode,
                    detected_at=detected_at,
                    feature_columns=feature_columns,
                    source_area_override=None,
                )
            )

    anomalies.sort(key=lambda item: float(item.get("anomaly_score") or 0.0), reverse=True)
    anomalies = anomalies[:MAX_ANOMALIES]

    if modeled_rows == 0:
        status = "insufficient_data"
    elif anomalies:
        status = "ok"
    else:
        status = "no_anomalies_detected"

    return {
        "status": status,
        "anomalies": anomalies,
        "metadata": serialize_anomaly_metadata(
            mode=mode,
            feature_columns=feature_columns,
            rows_modeled=modeled_rows,
            records_read=int(len(frame)),
            scored_groups=scored_groups,
            message=None,
        ),
    }


def add_scores(
    scored_frame: pd.DataFrame,
    model: IsolationForest,
    feature_columns: Sequence[str],
) -> pd.DataFrame:
    features = scored_frame[list(feature_columns)]
    prediction_labels = model.predict(features)
    raw_scores = -model.score_samples(features)
    raw_scores = np.asarray(raw_scores, dtype=float)

    if raw_scores.size == 0:
        normalized_scores = np.array([], dtype=float)
    else:
        minimum = float(raw_scores.min())
        maximum = float(raw_scores.max())
        spread = maximum - minimum
        if spread <= 0:
            normalized_scores = np.zeros_like(raw_scores)
        else:
            normalized_scores = (raw_scores - minimum) / spread

    result = scored_frame.copy()
    result["anomaly_flag"] = prediction_labels == -1
    result["anomaly_score"] = normalized_scores
    return result


# These helpers turn raw model output into the richer anomaly objects stored in S3 and
# later surfaced by the API.
def build_anomaly_output(
    *,
    scored_rows: pd.DataFrame,
    mode: str,
    detected_at: datetime,
    feature_columns: Sequence[str],
    source_area_override: Optional[str],
) -> List[Dict[str, Any]]:
    anomalies: List[Dict[str, Any]] = []
    flagged = scored_rows[scored_rows["anomaly_flag"]].copy()
    if flagged.empty:
        return anomalies

    flagged = flagged.sort_values("anomaly_score", ascending=False)
    for row in flagged.itertuples(index=False):
        row_dict = row._asdict()
        source_area = source_area_override or str(row_dict.get("source_area") or "finance")
        anomaly_type, title, description = describe_anomaly(row_dict, mode, source_area)
        anomaly_score = round(float(row_dict.get("anomaly_score") or 0.0), 4)
        severity = classify_severity(anomaly_score)

        if mode == "transaction":
            actual_value = round(float(row_dict.get("amount") or 0.0), 2)
            expected_value = round(float(row_dict.get("amount_baseline") or actual_value), 2)
            percent_deviation = percent_deviation_from(expected_value, actual_value)
            record_details = compact_record_snapshot(row_dict.get("raw") or {})
            details = {
                "transaction": record_details,
                "features": {
                    "amount": actual_value,
                    "daily_total": round(float(row_dict.get("daily_total") or 0.0), 2),
                    "transaction_count": int(row_dict.get("transaction_count") or 0),
                    "rolling_mean_7": round(float(row_dict.get("rolling_mean_7") or 0.0), 2),
                    "rolling_deviation_7": round(float(row_dict.get("rolling_deviation_7") or 0.0), 2),
                    "day_of_week": int(row_dict.get("day_of_week") or 0),
                },
            }
            reasons = [
                f"Transaction amount {format_currency(actual_value)} differs from the typical {source_area} amount baseline.",
                (
                    f"Daily total {format_currency(float(row_dict.get('daily_total') or 0.0))} "
                    f"vs rolling mean {format_currency(float(row_dict.get('rolling_mean_7') or 0.0))}."
                ),
            ]
            entity_type = "transaction"
            source_table = "transactions"
        else:
            actual_value = round(float(row_dict.get("daily_total") or 0.0), 2)
            expected_value = round(float(row_dict.get("rolling_mean_7") or actual_value), 2)
            percent_deviation = percent_deviation_from(expected_value, actual_value)
            details = {
                "record": {
                    "date": pd.Timestamp(row_dict["date"]).date().isoformat(),
                    "source_area": source_area,
                    "daily_total": actual_value,
                    "transaction_count": int(row_dict.get("transaction_count") or 0),
                },
                "features": {
                    "daily_total": actual_value,
                    "transaction_count": int(row_dict.get("transaction_count") or 0),
                    "rolling_mean_7": round(float(row_dict.get("rolling_mean_7") or 0.0), 2),
                    "rolling_deviation_7": round(float(row_dict.get("rolling_deviation_7") or 0.0), 2),
                    "day_of_week": int(row_dict.get("day_of_week") or 0),
                },
            }
            reasons = [
                (
                    f"Daily total {format_currency(actual_value)} differs from the rolling mean "
                    f"of {format_currency(expected_value)}."
                ),
                f"Transaction count for the day is {int(row_dict.get('transaction_count') or 0)}.",
            ]
            entity_type = "daily_finance"
            source_table = "finance_daily"

        anomalies.append(
            {
                "anomaly_id": str(uuid.uuid4()),
                "record_id": str(row_dict.get("record_id") or ""),
                "record_ids": [str(row_dict.get("record_id") or "")],
                "date": pd.Timestamp(row_dict["date"]).date().isoformat(),
                "anomaly_flag": True,
                "anomaly_score": anomaly_score,
                "source_area": source_area,
                "model_name": MODEL_NAME,
                "status": "new",
                "anomaly_type": anomaly_type,
                "entity_type": entity_type,
                "severity": severity,
                "confidence": anomaly_score,
                "title": title,
                "description": description,
                "reasons": reasons,
                "suggested_action": "review",
                "metrics": {
                    "actual_value": actual_value,
                    "expected_value": expected_value,
                    "percent_deviation": percent_deviation,
                    "z_score": None,
                },
                "detected_at": detected_at.isoformat(),
                "source_table": source_table,
                "audit_trail": [],
                "features_used": list(feature_columns),
                "details": details,
            }
        )

    return anomalies


def describe_anomaly(row: Dict[str, Any], mode: str, source_area: str) -> Tuple[str, str, str]:
    daily_total = float(row.get("daily_total") or 0.0)
    rolling_mean = float(row.get("rolling_mean_7") or 0.0)
    amount = float(row.get("amount") or 0.0)

    if mode == "daily":
        if source_area == "expenditure" and daily_total >= rolling_mean:
            return (
                "daily_expenditure_spike",
                "Unusual expenditure spike detected",
                "IsolationForest flagged the daily expenditure total as unusually high for recent history.",
            )
        if source_area == "revenue" and daily_total <= rolling_mean:
            return (
                "daily_revenue_drop",
                "Unusual revenue drop detected",
                "IsolationForest flagged the daily revenue total as unusually low for recent history.",
            )
        return (
            "daily_total_anomaly",
            "Suspicious daily finance total detected",
            "IsolationForest flagged the daily finance aggregate as outside the recent baseline.",
        )

    if source_area == "expenditure" and daily_total >= rolling_mean:
        return (
            "transaction_expenditure_spike",
            "Transaction sits inside an expenditure spike",
            "IsolationForest flagged this transaction because it lands on an unusually heavy spend day.",
        )
    if source_area == "revenue" and daily_total <= rolling_mean:
        return (
            "transaction_revenue_drop",
            "Transaction sits inside a low-revenue day",
            "IsolationForest flagged this transaction because it lands on an unusually weak revenue day.",
        )
    return (
        "transaction_amount_outlier",
        "Anomalous transaction amount detected",
        f"IsolationForest flagged the {source_area} transaction amount as unusual compared with recent activity.",
    )


def serialize_anomaly_metadata(
    *,
    mode: str,
    feature_columns: Sequence[str],
    rows_modeled: int,
    records_read: int,
    message: Optional[str],
    scored_groups: int = 0,
) -> Dict[str, Any]:
    payload = {
        "mode": mode,
        "model_name": MODEL_NAME,
        "parameters": dict(MODEL_PARAMS),
        "feature_columns": list(feature_columns),
        "rows_modeled": int(rows_modeled),
        "records_read": int(records_read),
        "scored_groups": int(scored_groups),
        "random_state": MODEL_RANDOM_STATE,
    }
    if message:
        payload["message"] = message
    return payload


# Shared parsing helpers below smooth over inconsistent source fields so the detector can
# handle mixed finance records without lots of special cases.
def summarize_counts(items: Sequence[Dict[str, Any]], field_name: str) -> Dict[str, int]:
    counts: Dict[str, int] = defaultdict(int)
    for item in items:
        key = str(item.get(field_name) or "unknown")
        counts[key] += 1
    return dict(sorted(counts.items(), key=lambda pair: pair[0]))


def generate_output_key(run_started_at: datetime) -> str:
    return (
        f"{ANALYTICS_PREFIX}"
        f"{run_started_at:%Y/%m/%d}/"
        f"anomalies_{run_started_at:%Y%m%dT%H%M%SZ}.json"
    )


def write_output(payload: Dict[str, Any], output_key: str) -> None:
    body = json.dumps(payload, default=str).encode("utf-8")
    S3_CLIENT.put_object(
        Bucket=DATA_LAKE_BUCKET,
        Key=output_key,
        Body=body,
        ContentType="application/json",
        ServerSideEncryption="AES256",
    )


def extract_first_string(record: Dict[str, Any], fields: Sequence[str]) -> str:
    for field in fields:
        if field not in record:
            continue
        value = record.get(field)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def extract_finance_amount(record: Dict[str, Any]) -> Optional[float]:
    for field in AMOUNT_FIELDS:
        if field not in record:
            continue
        parsed = parse_float(record.get(field))
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
    hint_text = " ".join(str(value).lower() for value in hint_fields if value is not None)
    if any(token in hint_text for token in REVENUE_HINTS):
        return "revenue"
    if any(token in hint_text for token in EXPENDITURE_HINTS):
        return "expenditure"
    return "revenue" if amount >= 0 else "expenditure"


def extract_record_datetime(record: Dict[str, Any]) -> Optional[datetime]:
    for field in DATE_FIELDS:
        if field not in record:
            continue
        parsed = parse_datetime(record.get(field))
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
        number = float(value)
        if number > 10_000_000_000:
            number = number / 1000.0
        return datetime.fromtimestamp(number, tz=timezone.utc)
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


def extract_date_from_key(key: str) -> Optional[date]:
    match = re.search(r"/(\d{4})/(\d{2})/(\d{2})(?:/|$)", key)
    if not match:
        return None

    year, month, day = match.groups()
    try:
        return date(int(year), int(month), int(day))
    except ValueError:
        return None


def compact_record_snapshot(record: Dict[str, Any], max_fields: int = 12) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for key in sorted(record.keys()):
        if key.startswith("_"):
            continue
        if len(result) >= max_fields:
            break
        result[key] = record[key]
    return result


def classify_severity(anomaly_score: float) -> str:
    if anomaly_score >= 0.75:
        return "high"
    if anomaly_score >= 0.4:
        return "medium"
    return "low"


def percent_deviation_from(expected: float, actual: float) -> Optional[float]:
    if expected == 0:
        return None
    return round(((actual - expected) / abs(expected)) * 100.0, 2)


def format_currency(value: float) -> str:
    return f"${value:,.2f}"
