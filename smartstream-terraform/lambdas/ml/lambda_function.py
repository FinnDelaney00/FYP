import gzip
import json
import logging
import os
import re
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from typing import Any, Dict, List, Optional, Sequence, Tuple

import boto3
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor

LOGGER = logging.getLogger()
if not LOGGER.handlers:
    logging.basicConfig()
LOGGER.setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())

S3_CLIENT = boto3.client("s3")
SCHEMA_VERSION = "2.0"
MODEL_NAME = "RandomForestRegressor"
MODEL_RANDOM_STATE = 42
FEATURE_COLUMNS = [
    "lag_1",
    "lag_7",
    "lag_14",
    "rolling_mean_7",
    "rolling_mean_14",
    "day_of_week",
    "month",
]
MAX_LAG = 14
MIN_TRAINING_ROWS = 7
MIN_HISTORY_POINTS = MAX_LAG + MIN_TRAINING_ROWS
MODEL_PARAMS = {
    "n_estimators": 160,
    "max_depth": 8,
    "min_samples_leaf": 2,
    "random_state": MODEL_RANDOM_STATE,
    "n_jobs": 1,
}


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
    del context
    run_started_at = datetime.now(timezone.utc)

    LOGGER.info("ML inference started at %s", run_started_at.isoformat())
    LOGGER.info(
        (
            "Configuration: bucket=%s trusted_prefix=%s analytics_prefix=%s "
            "max_input_files=%d forecast_days=%d"
        ),
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
                "forecast_days": FORECAST_DAYS,
            },
            "input_objects": {
                "employees": [obj["Key"] for obj in employee_objects],
                "finance": [obj["Key"] for obj in finance_objects],
            },
        }

        employee_records = read_records_from_objects(DATA_LAKE_BUCKET, employee_objects)
        finance_records = read_records_from_objects(DATA_LAKE_BUCKET, finance_objects)

        diagnostics["rows_processed"] = {
            "employees": len(employee_records),
            "finance": len(finance_records),
        }

        employee_insight = build_employee_growth_insight(employee_records, FORECAST_DAYS)
        finance_insight = build_finance_insight(finance_records, FORECAST_DAYS)

        status = derive_overall_status(
            employee_records=employee_records,
            finance_records=finance_records,
            employee_insight=employee_insight,
            finance_insight=finance_insight,
        )

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


def derive_overall_status(
    *,
    employee_records: Sequence[Dict[str, Any]],
    finance_records: Sequence[Dict[str, Any]],
    employee_insight: Dict[str, Any],
    finance_insight: Dict[str, Any],
) -> str:
    if not employee_records and not finance_records:
        return "no_input_data"

    statuses = [
        employee_insight.get("status"),
        finance_insight.get("status"),
        (finance_insight.get("revenue") or {}).get("status"),
        (finance_insight.get("expenditure") or {}).get("status"),
    ]
    ok_count = sum(1 for value in statuses if value == "ok")
    insufficient_count = sum(1 for value in statuses if value == "insufficient_data")

    if ok_count >= 3:
        return "ok"
    if ok_count > 0 or insufficient_count > 0:
        return "partial_data"
    return "insufficient_data"


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
    selected = objects[:limit]
    LOGGER.info("Found %d objects under %s, selected %d", len(objects), prefix, len(selected))
    return selected


def read_records_from_objects(bucket: str, objects: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    all_records: List[Dict[str, Any]] = []

    for obj in objects:
        key = str(obj["Key"])
        try:
            payload = read_s3_object_text(bucket, key)
            parsed_records = parse_records(payload, key)
        except Exception:
            LOGGER.exception("Failed reading/parsing object %s", key)
            continue

        for record in parsed_records:
            enriched = dict(record)
            enriched["_source_key"] = key
            last_modified = obj.get("LastModified")
            if isinstance(last_modified, datetime):
                enriched["_source_last_modified"] = last_modified.isoformat()
            all_records.append(enriched)

        LOGGER.info("Read %d records from %s", len(parsed_records), key)

    return all_records


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
        return insufficient_metric_result(
            metric_name="employee_headcount",
            history_field="headcount",
            prediction_field="predicted_headcount",
            message=f"No employee records found under {EMPLOYEES_PREFIX}.",
        )

    events: List[Tuple[datetime, str, Optional[bool]]] = []
    for record in records:
        employee_id = extract_employee_id(record)
        event_dt = extract_record_datetime(record)
        if not employee_id or not event_dt:
            continue
        events.append((event_dt, employee_id, infer_employee_active(record)))

    if not events:
        return insufficient_metric_result(
            metric_name="employee_headcount",
            history_field="headcount",
            prediction_field="predicted_headcount",
            message="Employee records exist but missing usable IDs/timestamps.",
        )

    events.sort(key=lambda item: item[0])

    active_ids: set[str] = set()
    counts_by_date: Dict[date, float] = {}

    for event_dt, employee_id, is_active in events:
        if is_active is False:
            active_ids.discard(employee_id)
        else:
            active_ids.add(employee_id)
        counts_by_date[event_dt.date()] = float(len(active_ids))

    series = build_daily_series(values_by_date=counts_by_date, carry_forward=True)
    return build_forecast_output(
        metric_name="employee_headcount",
        history_field="headcount",
        prediction_field="predicted_headcount",
        series=series,
        forecast_days=forecast_days,
        integer_output=True,
        source_rows=len(events),
        source_area="employees",
    )


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
        record_date = event_dt.date()

        if classify_finance_amount(record, amount) == "revenue":
            revenue_by_date[record_date] += abs(amount)
        else:
            expenditure_by_date[record_date] += abs(amount)

    if usable_rows == 0:
        return insufficient_finance_result("Finance files exist but no usable amount/timestamp records were found.")

    all_dates = sorted(set(revenue_by_date.keys()) | set(expenditure_by_date.keys()))
    if not all_dates:
        return insufficient_finance_result("No dated finance records available for forecasting.")

    start_date = all_dates[0]
    end_date = all_dates[-1]

    revenue_series = build_daily_series(
        values_by_date=revenue_by_date,
        carry_forward=False,
        start_date=start_date,
        end_date=end_date,
    )
    expenditure_series = build_daily_series(
        values_by_date=expenditure_by_date,
        carry_forward=False,
        start_date=start_date,
        end_date=end_date,
    )

    revenue_result = build_forecast_output(
        metric_name="revenue",
        history_field="revenue",
        prediction_field="predicted_revenue",
        series=revenue_series,
        forecast_days=forecast_days,
        integer_output=False,
        source_rows=usable_rows,
        source_area="finance_revenue",
    )
    expenditure_result = build_forecast_output(
        metric_name="expenditure",
        history_field="expenditure",
        prediction_field="predicted_expenditure",
        series=expenditure_series,
        forecast_days=forecast_days,
        integer_output=False,
        source_rows=usable_rows,
        source_area="finance_expenditure",
    )

    if revenue_result["status"] == "ok" and expenditure_result["status"] == "ok":
        overall_status = "ok"
    elif revenue_result["status"] == "insufficient_data" and expenditure_result["status"] == "insufficient_data":
        overall_status = "insufficient_data"
    else:
        overall_status = "partial_data"

    return {
        "status": overall_status,
        "forecast_days": forecast_days,
        "rows_used": usable_rows,
        "revenue": revenue_result,
        "expenditure": expenditure_result,
    }


def build_daily_series(
    *,
    values_by_date: Dict[date, float],
    carry_forward: bool,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
) -> pd.Series:
    if not values_by_date:
        return pd.Series(dtype="float64")

    first_date = start_date or min(values_by_date.keys())
    last_date = end_date or max(values_by_date.keys())
    index = pd.date_range(start=first_date, end=last_date, freq="D")
    series = pd.Series(index=index, dtype="float64")

    for entry_date, value in values_by_date.items():
        series.loc[pd.Timestamp(entry_date)] = float(value)

    if carry_forward:
        series = series.ffill().fillna(0.0)
    else:
        series = series.fillna(0.0)

    return series.astype("float64")


def build_forecast_training_frame(series: pd.Series) -> pd.DataFrame:
    frame = pd.DataFrame({"target": series.astype("float64")})
    shifted = frame["target"].shift(1)
    frame["lag_1"] = frame["target"].shift(1)
    frame["lag_7"] = frame["target"].shift(7)
    frame["lag_14"] = frame["target"].shift(14)
    frame["rolling_mean_7"] = shifted.rolling(window=7, min_periods=7).mean()
    frame["rolling_mean_14"] = shifted.rolling(window=14, min_periods=14).mean()
    frame["day_of_week"] = frame.index.dayofweek
    frame["month"] = frame.index.month
    return frame.dropna().copy()


def train_random_forest_forecaster(training_frame: pd.DataFrame) -> Tuple[RandomForestRegressor, Dict[str, Any]]:
    model = RandomForestRegressor(**MODEL_PARAMS)
    features = training_frame[FEATURE_COLUMNS]
    target = training_frame["target"]
    model.fit(features, target)

    fitted_values = model.predict(features)
    residuals = target.to_numpy(dtype=float) - np.asarray(fitted_values, dtype=float)
    residual_std = float(np.std(residuals, ddof=1)) if len(residuals) > 1 else 0.0

    return model, {
        "model_name": MODEL_NAME,
        "rows_used": int(len(training_frame)),
        "features_used": list(FEATURE_COLUMNS),
        "parameters": dict(MODEL_PARAMS),
        "residual_std": residual_std,
        "interval_method": "residual_training_error_spread",
    }


def recursive_forecast(
    *,
    history_series: pd.Series,
    model: RandomForestRegressor,
    forecast_days: int,
    metric_name: str,
    prediction_field: str,
    integer_output: bool,
    model_metadata: Dict[str, Any],
) -> List[Dict[str, Any]]:
    history_values = [float(value) for value in history_series.tolist()]
    last_date = pd.Timestamp(history_series.index[-1])
    residual_std = float(model_metadata.get("residual_std") or 0.0)
    rows_used = int(model_metadata.get("rows_used") or 0)

    forecast_rows: List[Dict[str, Any]] = []
    for step in range(1, forecast_days + 1):
        target_date = last_date + pd.Timedelta(days=step)
        feature_row = build_recursive_feature_row(history_values, target_date)
        prediction = float(model.predict(pd.DataFrame([feature_row], columns=FEATURE_COLUMNS))[0])
        prediction = max(0.0, prediction)

        # Residual spread is used as a lightweight approximation for uncertainty.
        interval_scale = 1.0 + (step / max(1, forecast_days))
        half_width = max(1.0 if integer_output else 0.01, 1.96 * residual_std * interval_scale)
        lower_bound = max(0.0, prediction - half_width)
        upper_bound = max(lower_bound, prediction + half_width)

        formatted_prediction = format_numeric(prediction, integer_output)
        formatted_lower = format_numeric(lower_bound, integer_output)
        formatted_upper = format_numeric(upper_bound, integer_output)

        forecast_rows.append(
            {
                "metric_name": metric_name,
                "date": target_date.date().isoformat(),
                "predicted_value": formatted_prediction,
                prediction_field: formatted_prediction,
                "lower_bound": formatted_lower,
                "upper_bound": formatted_upper,
                "lower_ci": formatted_lower,
                "upper_ci": formatted_upper,
                "model_name": MODEL_NAME,
                "rows_used": rows_used,
                "features_used": list(FEATURE_COLUMNS),
                "status": "ok",
            }
        )

        history_values.append(prediction)

    return forecast_rows


def build_recursive_feature_row(history_values: Sequence[float], target_date: pd.Timestamp) -> Dict[str, float]:
    return {
        "lag_1": float(history_values[-1]),
        "lag_7": float(history_values[-7]),
        "lag_14": float(history_values[-14]),
        "rolling_mean_7": float(np.mean(history_values[-7:])),
        "rolling_mean_14": float(np.mean(history_values[-14:])),
        "day_of_week": float(target_date.dayofweek),
        "month": float(target_date.month),
    }


def build_forecast_output(
    *,
    metric_name: str,
    history_field: str,
    prediction_field: str,
    series: pd.Series,
    forecast_days: int,
    integer_output: bool,
    source_rows: int,
    source_area: str,
) -> Dict[str, Any]:
    history = serialize_history(series, history_field, integer_output)

    if len(series) < MIN_HISTORY_POINTS:
        return insufficient_metric_result(
            metric_name=metric_name,
            history_field=history_field,
            prediction_field=prediction_field,
            history=history,
            source_rows=source_rows,
            message=(
                f"Need at least {MIN_HISTORY_POINTS} daily points for {MODEL_NAME}; "
                f"found {len(series)}."
            ),
            source_area=source_area,
        )

    training_frame = build_forecast_training_frame(series)
    if len(training_frame) < MIN_TRAINING_ROWS:
        return insufficient_metric_result(
            metric_name=metric_name,
            history_field=history_field,
            prediction_field=prediction_field,
            history=history,
            source_rows=source_rows,
            message=(
                f"Need at least {MIN_TRAINING_ROWS} supervised training rows after lag generation; "
                f"found {len(training_frame)}."
            ),
            source_area=source_area,
        )

    model, model_metadata = train_random_forest_forecaster(training_frame)
    forecast = recursive_forecast(
        history_series=series,
        model=model,
        forecast_days=forecast_days,
        metric_name=metric_name,
        prediction_field=prediction_field,
        integer_output=integer_output,
        model_metadata=model_metadata,
    )

    return {
        "status": "ok",
        "method": "random_forest_lag_features",
        "model_name": MODEL_NAME,
        "source_area": source_area,
        "forecast_days": forecast_days,
        "rows_used": model_metadata["rows_used"],
        "source_rows": source_rows,
        "features_used": list(FEATURE_COLUMNS),
        "history": history,
        "forecast": forecast,
        "metadata": serialize_forecast_metadata(
            model_metadata=model_metadata,
            history_points=len(series),
            metric_name=metric_name,
        ),
    }


def serialize_history(series: pd.Series, value_name: str, integer_output: bool) -> List[Dict[str, Any]]:
    history: List[Dict[str, Any]] = []
    for index_value, numeric_value in series.items():
        history.append(
            {
                "date": pd.Timestamp(index_value).date().isoformat(),
                value_name: format_numeric(float(numeric_value), integer_output),
            }
        )
    return history


def serialize_forecast_metadata(
    *,
    model_metadata: Dict[str, Any],
    history_points: int,
    metric_name: str,
) -> Dict[str, Any]:
    return {
        "metric_name": metric_name,
        "model_name": model_metadata.get("model_name"),
        "parameters": model_metadata.get("parameters"),
        "features_used": model_metadata.get("features_used"),
        "rows_used": model_metadata.get("rows_used"),
        "history_points": history_points,
        "interval_method": model_metadata.get("interval_method"),
        "random_state": MODEL_RANDOM_STATE,
    }


def insufficient_metric_result(
    *,
    metric_name: str,
    history_field: str,
    prediction_field: str,
    message: str,
    history: Optional[List[Dict[str, Any]]] = None,
    source_rows: int = 0,
    source_area: str = "",
) -> Dict[str, Any]:
    del prediction_field
    return {
        "status": "insufficient_data",
        "message": message,
        "model_name": MODEL_NAME,
        "source_area": source_area,
        "rows_used": 0,
        "source_rows": source_rows,
        "features_used": list(FEATURE_COLUMNS),
        "history": history or [],
        "forecast": [],
        "metadata": {
            "metric_name": metric_name,
            "model_name": MODEL_NAME,
            "history_field": history_field,
            "features_used": list(FEATURE_COLUMNS),
            "rows_used": 0,
            "random_state": MODEL_RANDOM_STATE,
        },
    }


def insufficient_finance_result(message: str) -> Dict[str, Any]:
    return {
        "status": "insufficient_data",
        "message": message,
        "revenue": insufficient_metric_result(
            metric_name="revenue",
            history_field="revenue",
            prediction_field="predicted_revenue",
            message=message,
            source_area="finance_revenue",
        ),
        "expenditure": insufficient_metric_result(
            metric_name="expenditure",
            history_field="expenditure",
            prediction_field="predicted_expenditure",
            message=message,
            source_area="finance_expenditure",
        ),
    }


def format_numeric(value: float, integer_output: bool) -> Any:
    value = max(0.0, float(value))
    if integer_output:
        return int(round(value))
    return round(value, 2)


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
