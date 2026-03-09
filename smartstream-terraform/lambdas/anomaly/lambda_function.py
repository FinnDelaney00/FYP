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


def _read_int_env(name: str, default: int, minimum: int = 0) -> int:
    raw_value = os.environ.get(name, str(default))
    try:
        parsed = int(raw_value)
    except ValueError as exc:
        raise ValueError(f"Environment variable {name} must be an integer, got {raw_value!r}") from exc
    if parsed < minimum:
        raise ValueError(f"Environment variable {name} must be >= {minimum}, got {parsed}")
    return parsed


def _read_float_env(name: str, default: float, minimum: float = 0.0) -> float:
    raw_value = os.environ.get(name, str(default))
    try:
        parsed = float(raw_value)
    except ValueError as exc:
        raise ValueError(f"Environment variable {name} must be a float, got {raw_value!r}") from exc
    if parsed < minimum:
        raise ValueError(f"Environment variable {name} must be >= {minimum}, got {parsed}")
    return parsed


DATA_LAKE_BUCKET = os.environ["DATA_LAKE_BUCKET"]
TRUSTED_PREFIX = _normalize_prefix(os.environ.get("TRUSTED_PREFIX"), "trusted/")
EMPLOYEES_PREFIX = _normalize_prefix(os.environ.get("EMPLOYEES_PREFIX"), f"{TRUSTED_PREFIX}employees/")
TRANSACTIONS_PREFIX = _normalize_prefix(
    os.environ.get("TRANSACTIONS_PREFIX"),
    f"{TRUSTED_PREFIX}finance/transactions/",
)
ANALYTICS_PREFIX = _normalize_prefix(
    os.environ.get("ANALYTICS_PREFIX"),
    "trusted-analytics/anomalies/",
)
MAX_INPUT_FILES = _read_int_env("MAX_INPUT_FILES", 20, minimum=1)

SALARY_OUTLIER_ZSCORE_THRESHOLD = _read_float_env("SALARY_OUTLIER_ZSCORE_THRESHOLD", 2.5, minimum=0.5)
DUPLICATE_TRANSACTION_WINDOW_MINUTES = _read_int_env("DUPLICATE_TRANSACTION_WINDOW_MINUTES", 10, minimum=1)
LARGE_TRANSACTION_MULTIPLIER = _read_float_env("LARGE_TRANSACTION_MULTIPLIER", 3.0, minimum=1.1)
SMALL_TRANSACTION_FLOOR_RATIO = _read_float_env("SMALL_TRANSACTION_FLOOR_RATIO", 0.25, minimum=0.01)

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
EMPLOYEE_EMAIL_FIELDS = ("email", "work_email", "employee_email")
EMPLOYEE_NAME_FIELDS = ("full_name", "name", "employee_name")
EMPLOYEE_FIRST_NAME_FIELDS = ("first_name", "firstname", "given_name")
EMPLOYEE_LAST_NAME_FIELDS = ("last_name", "lastname", "family_name", "surname")
EMPLOYEE_DEPARTMENT_FIELDS = ("department", "dept", "team", "division")
EMPLOYEE_ROLE_FIELDS = ("role", "title", "job_title", "position")
EMPLOYEE_HIRE_DATE_FIELDS = ("hire_date", "start_date", "joining_date", "date_of_joining")
EMPLOYEE_SALARY_FIELDS = ("salary", "annual_salary", "base_salary", "compensation", "pay")

TRANSACTION_ID_FIELDS = ("transaction_id", "txn_id", "id", "entry_id")
TRANSACTION_ACCOUNT_FIELDS = ("account_id", "account", "account_number", "customer_id", "customer")
TRANSACTION_VENDOR_FIELDS = ("vendor", "merchant", "merchant_name", "vendor_name", "payee", "counterparty")
TRANSACTION_CATEGORY_FIELDS = ("category", "transaction_type", "type", "entry_type")
TRANSACTION_AMOUNT_FIELDS = ("amount", "transaction_amount", "value", "total", "net_amount")


def lambda_handler(event, context):
    run_started_at = datetime.now(timezone.utc)
    LOGGER.info(
        (
            "Anomaly detector started at %s "
            "(employees_prefix=%s transactions_prefix=%s analytics_prefix=%s max_input_files=%d)"
        ),
        run_started_at.isoformat(),
        EMPLOYEES_PREFIX,
        TRANSACTIONS_PREFIX,
        ANALYTICS_PREFIX,
        MAX_INPUT_FILES,
    )
    LOGGER.info(
        (
            "Thresholds: salary_z=%.3f duplicate_window_minutes=%d "
            "large_multiplier=%.3f small_floor_ratio=%.3f"
        ),
        SALARY_OUTLIER_ZSCORE_THRESHOLD,
        DUPLICATE_TRANSACTION_WINDOW_MINUTES,
        LARGE_TRANSACTION_MULTIPLIER,
        SMALL_TRANSACTION_FLOOR_RATIO,
    )

    employee_objects = list_recent_objects(DATA_LAKE_BUCKET, EMPLOYEES_PREFIX, MAX_INPUT_FILES)
    transaction_objects = list_recent_objects(DATA_LAKE_BUCKET, TRANSACTIONS_PREFIX, MAX_INPUT_FILES)

    employee_records = read_records_from_objects(DATA_LAKE_BUCKET, employee_objects)
    transaction_records = read_records_from_objects(DATA_LAKE_BUCKET, transaction_objects)

    anomalies: List[Dict[str, Any]] = []
    anomalies.extend(detect_salary_outliers(employee_records, run_started_at))
    anomalies.extend(detect_duplicate_hires(employee_records, run_started_at))
    anomalies.extend(detect_duplicate_transactions(transaction_records, run_started_at))
    anomalies.extend(detect_large_transactions(transaction_records, run_started_at))
    anomalies.extend(detect_small_suspicious_transactions(transaction_records, run_started_at))
    anomalies = deduplicate_anomalies(anomalies)

    payload = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": run_started_at.isoformat(),
        "status": "ok" if anomalies else "no_anomalies_detected",
        "summary": {
            "total": len(anomalies),
            "by_severity": summarize_counts(anomalies, "severity"),
            "by_type": summarize_counts(anomalies, "anomaly_type"),
        },
        "source": {
            "bucket": DATA_LAKE_BUCKET,
            "employees_prefix": EMPLOYEES_PREFIX,
            "transactions_prefix": TRANSACTIONS_PREFIX,
            "employees_objects": [obj["Key"] for obj in employee_objects],
            "transaction_objects": [obj["Key"] for obj in transaction_objects],
            "rows_processed": {
                "employees": len(employee_records),
                "transactions": len(transaction_records),
            },
            "event_summary": summarize_event(event),
        },
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


def detect_salary_outliers(records: Sequence[Dict[str, Any]], detected_at: datetime) -> List[Dict[str, Any]]:
    employee_rows = normalize_employee_rows(records)
    with_salary = [row for row in employee_rows if row["salary"] is not None]
    if len(with_salary) < 4:
        return []

    groups: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in with_salary:
        grouping_values = [row.get("department") or "", row.get("role") or ""]
        group_key = "|".join(value.lower() for value in grouping_values if value)
        groups[group_key or "__all__"].append(row)

    anomalies: List[Dict[str, Any]] = []
    for group_key, members in groups.items():
        if len(members) < 4:
            continue
        salaries = sorted(float(member["salary"]) for member in members if member["salary"] is not None)
        if len(salaries) < 4:
            continue

        q1 = percentile(salaries, 25)
        q3 = percentile(salaries, 75)
        iqr = q3 - q1
        median = percentile(salaries, 50)
        mean = sum(salaries) / len(salaries)
        std_dev = standard_deviation(salaries, mean)

        iqr_lower = q1 - 1.5 * iqr
        iqr_upper = q3 + 1.5 * iqr

        for member in members:
            salary = member["salary"]
            if salary is None:
                continue
            z_score = (salary - mean) / std_dev if std_dev > 0 else 0.0
            is_iqr_outlier = salary < iqr_lower or salary > iqr_upper
            is_z_outlier = abs(z_score) >= SALARY_OUTLIER_ZSCORE_THRESHOLD
            if not (is_iqr_outlier or is_z_outlier):
                continue

            deviation_percent = percent_deviation(salary, median)
            expected_low = max(0.0, iqr_lower)
            expected_high = max(expected_low, iqr_upper)
            severity = classify_salary_outlier_severity(abs(z_score), abs(deviation_percent or 0.0))
            group_label = describe_employee_group(member, group_key)
            direction = "higher" if salary >= median else "lower"

            anomalies.append(
                build_anomaly(
                    entity_type="employee",
                    record_ids=[member["employee_id"]],
                    anomaly_type="salary_outlier",
                    severity=severity,
                    confidence=confidence_from_score(abs(z_score), floor=0.55, cap=0.97),
                    title=f"Salary {direction} than expected",
                    description=(
                        f"Employee salary in {group_label} is outside the expected salary range "
                        f"for comparable records."
                    ),
                    reasons=[
                        f"Observed salary {format_currency(salary)} is outside "
                        f"{format_currency(expected_low)} to {format_currency(expected_high)}.",
                        f"Salary z-score is {round(z_score, 3)}.",
                    ],
                    suggested_action="review",
                    metrics={
                        "actual_value": round(salary, 2),
                        "expected_value": round(median, 2),
                        "percent_deviation": round(deviation_percent, 2) if deviation_percent is not None else None,
                        "z_score": round(z_score, 3),
                    },
                    detected_at=detected_at,
                    source_table="employees",
                    details={
                        "group": group_label,
                        "expected_range": {
                            "min": round(expected_low, 2),
                            "max": round(expected_high, 2),
                        },
                        "employee": compact_record_snapshot(member["raw"]),
                    },
                )
            )

    LOGGER.info("Detected %d salary outliers", len(anomalies))
    return anomalies


def detect_duplicate_hires(records: Sequence[Dict[str, Any]], detected_at: datetime) -> List[Dict[str, Any]]:
    employee_rows = normalize_employee_rows(records)
    if len(employee_rows) < 2:
        return []

    anomalies: List[Dict[str, Any]] = []
    seen_signatures: set[Tuple[str, Tuple[str, ...]]] = set()

    def add_duplicate_anomaly(
        members: Sequence[Dict[str, Any]],
        matched_fields: Sequence[str],
        confidence: float,
        severity: str,
        title: str,
        description: str,
    ) -> None:
        ids = sorted({member["employee_id"] for member in members})
        if len(ids) < 2:
            return
        signature = ("duplicate_hire", tuple(ids))
        if signature in seen_signatures:
            return
        seen_signatures.add(signature)

        anomalies.append(
            build_anomaly(
                entity_type="employee",
                record_ids=ids,
                anomaly_type="duplicate_hire",
                severity=severity,
                confidence=round(confidence, 3),
                title=title,
                description=description,
                reasons=[f"Matched on fields: {', '.join(matched_fields)}."],
                suggested_action="review",
                metrics={
                    "actual_value": float(len(ids)),
                    "expected_value": 1.0,
                    "percent_deviation": round(((len(ids) - 1) / 1.0) * 100.0, 2),
                    "z_score": None,
                },
                detected_at=detected_at,
                source_table="employees",
                details={
                    "matched_fields": list(matched_fields),
                    "matched_records": [compact_record_snapshot(member["raw"]) for member in members],
                },
            )
        )

    by_email: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in employee_rows:
        email = normalize_string(row.get("email"))
        if email:
            by_email[email].append(row)

    for email, members in by_email.items():
        if len(members) > 1:
            add_duplicate_anomaly(
                members=members,
                matched_fields=[f"email={email}"],
                confidence=0.98,
                severity="high",
                title="Likely duplicate employee records",
                description="Multiple employee records share the same email address.",
            )

    by_name: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in employee_rows:
        full_name = normalize_name(row.get("full_name"))
        if full_name:
            by_name[full_name].append(row)

    for name, members in by_name.items():
        if len(members) > 1:
            add_duplicate_anomaly(
                members=members,
                matched_fields=[f"full_name={name}"],
                confidence=0.85,
                severity="medium",
                title="Potential duplicate hire records",
                description="Multiple employee records share the same full name.",
            )

    by_composite: Dict[Tuple[str, str], List[Dict[str, Any]]] = defaultdict(list)
    for row in employee_rows:
        department = normalize_string(row.get("department"))
        hire_date = row.get("hire_date")
        if not department or not isinstance(hire_date, date):
            continue
        by_composite[(department, hire_date.isoformat())].append(row)

    for (department, hire_date), members in by_composite.items():
        if len(members) < 2:
            continue
        members_sorted = sorted(
            members,
            key=lambda item: item["salary"] if item["salary"] is not None else float("inf"),
        )
        cluster: List[Dict[str, Any]] = []
        for member in members_sorted:
            salary = member["salary"]
            if salary is None:
                continue
            if not cluster:
                cluster.append(member)
                continue
            baseline = cluster[-1]["salary"] or salary
            salary_gap_ratio = abs(salary - baseline) / max(abs(baseline), 1.0)
            if salary_gap_ratio <= 0.05:
                cluster.append(member)
            else:
                if len(cluster) > 1:
                    add_duplicate_anomaly(
                        members=cluster,
                        matched_fields=[
                            f"department={department}",
                            f"hire_date={hire_date}",
                            "salary_within_5_percent",
                        ],
                        confidence=0.78,
                        severity="medium",
                        title="Possible duplicate hires in same department",
                        description=(
                            "Employees share the same department and hire date, "
                            "with near-identical salaries."
                        ),
                    )
                cluster = [member]

        if len(cluster) > 1:
            add_duplicate_anomaly(
                members=cluster,
                matched_fields=[
                    f"department={department}",
                    f"hire_date={hire_date}",
                    "salary_within_5_percent",
                ],
                confidence=0.78,
                severity="medium",
                title="Possible duplicate hires in same department",
                description=(
                    "Employees share the same department and hire date, "
                    "with near-identical salaries."
                ),
            )

    LOGGER.info("Detected %d duplicate employee anomalies", len(anomalies))
    return anomalies


def detect_duplicate_transactions(records: Sequence[Dict[str, Any]], detected_at: datetime) -> List[Dict[str, Any]]:
    transaction_rows = normalize_transaction_rows(records)
    if len(transaction_rows) < 2:
        return []

    grouped: Dict[Tuple[str, str, float], List[Dict[str, Any]]] = defaultdict(list)
    for row in transaction_rows:
        timestamp = row.get("timestamp")
        amount = row.get("amount")
        account_key = normalize_string(row.get("account_key"))
        vendor = normalize_string(row.get("vendor")) or "unknown"
        if amount is None or timestamp is None:
            continue
        if not account_key:
            account_key = "unknown-account"
        amount_key = round(float(amount), 2)
        grouped[(account_key, vendor, amount_key)].append(row)

    anomalies: List[Dict[str, Any]] = []
    window_seconds = DUPLICATE_TRANSACTION_WINDOW_MINUTES * 60
    for (account_key, vendor, amount_key), members in grouped.items():
        if len(members) < 2:
            continue
        ordered = sorted(members, key=lambda item: item["timestamp"])
        cluster = [ordered[0]]
        for candidate in ordered[1:]:
            last_ts = cluster[-1]["timestamp"]
            current_ts = candidate["timestamp"]
            if not isinstance(last_ts, datetime) or not isinstance(current_ts, datetime):
                continue
            delta_seconds = abs((current_ts - last_ts).total_seconds())
            if delta_seconds <= window_seconds:
                cluster.append(candidate)
            else:
                if len(cluster) > 1:
                    anomalies.append(
                        build_duplicate_transaction_anomaly(
                            cluster=cluster,
                            account_key=account_key,
                            vendor=vendor,
                            amount_key=amount_key,
                            detected_at=detected_at,
                        )
                    )
                cluster = [candidate]
        if len(cluster) > 1:
            anomalies.append(
                build_duplicate_transaction_anomaly(
                    cluster=cluster,
                    account_key=account_key,
                    vendor=vendor,
                    amount_key=amount_key,
                    detected_at=detected_at,
                )
            )

    LOGGER.info("Detected %d duplicate transaction anomalies", len(anomalies))
    return anomalies


def build_duplicate_transaction_anomaly(
    cluster: Sequence[Dict[str, Any]],
    account_key: str,
    vendor: str,
    amount_key: float,
    detected_at: datetime,
) -> Dict[str, Any]:
    ids = sorted({item["transaction_id"] for item in cluster})
    total_value = amount_key * len(ids)
    confidence = min(0.99, 0.84 + (0.05 * min(3, len(ids) - 1)))
    severity = "high" if len(ids) >= 3 or amount_key >= 10000 else "medium"

    return build_anomaly(
        entity_type="transaction",
        record_ids=ids,
        anomaly_type="duplicate_transaction",
        severity=severity,
        confidence=round(confidence, 3),
        title="Possible duplicate transactions detected",
        description=(
            "Transactions share account, vendor, and amount, with posting times inside "
            "the configured duplicate window."
        ),
        reasons=[
            f"Matched account={account_key}, vendor={vendor}, amount={format_currency(amount_key)}.",
            f"Timestamps are within {DUPLICATE_TRANSACTION_WINDOW_MINUTES} minutes.",
        ],
        suggested_action="quarantine",
        metrics={
            "actual_value": round(total_value, 2),
            "expected_value": round(amount_key, 2),
            "percent_deviation": round(((total_value - amount_key) / max(amount_key, 1.0)) * 100.0, 2),
            "z_score": None,
        },
        detected_at=detected_at,
        source_table="transactions",
        details={
            "match_key": {
                "account": account_key,
                "vendor": vendor,
                "amount": round(amount_key, 2),
            },
            "linked_transactions": [compact_record_snapshot(item["raw"]) for item in cluster],
        },
    )


def detect_large_transactions(records: Sequence[Dict[str, Any]], detected_at: datetime) -> List[Dict[str, Any]]:
    grouped = group_transactions_for_context(records)
    anomalies: List[Dict[str, Any]] = []

    for context_key, members in grouped.items():
        amounts = [member["amount"] for member in members if member["amount"] is not None]
        if len(amounts) < 8:
            continue

        sorted_amounts = sorted(float(value) for value in amounts)
        median = percentile(sorted_amounts, 50)
        p75 = percentile(sorted_amounts, 75)
        if median <= 0:
            continue

        threshold = max(median * LARGE_TRANSACTION_MULTIPLIER, p75 * 1.5)
        for member in members:
            amount = member["amount"]
            if amount is None or amount <= threshold:
                continue
            deviation = percent_deviation(amount, median)
            severity = "high" if amount >= median * (LARGE_TRANSACTION_MULTIPLIER + 1.5) else "medium"
            anomalies.append(
                build_anomaly(
                    entity_type="transaction",
                    record_ids=[member["transaction_id"]],
                    anomaly_type="large_transaction",
                    severity=severity,
                    confidence=confidence_from_score((amount / max(median, 1.0)), floor=0.62, cap=0.98),
                    title="Unusually large transaction",
                    description=(
                        "Transaction amount is significantly higher than baseline for this "
                        "account/category context."
                    ),
                    reasons=[
                        f"Observed {format_currency(amount)} vs baseline median {format_currency(median)}.",
                        f"Configured multiplier threshold is {LARGE_TRANSACTION_MULTIPLIER}x.",
                    ],
                    suggested_action="review",
                    metrics={
                        "actual_value": round(amount, 2),
                        "expected_value": round(median, 2),
                        "percent_deviation": round(deviation, 2) if deviation is not None else None,
                        "z_score": None,
                    },
                    detected_at=detected_at,
                    source_table="transactions",
                    details={
                        "context_key": context_key,
                        "baseline": {
                            "median": round(median, 2),
                            "p75": round(p75, 2),
                            "threshold": round(threshold, 2),
                        },
                        "transaction": compact_record_snapshot(member["raw"]),
                    },
                )
            )

    LOGGER.info("Detected %d large transaction anomalies", len(anomalies))
    return anomalies


def detect_small_suspicious_transactions(records: Sequence[Dict[str, Any]], detected_at: datetime) -> List[Dict[str, Any]]:
    grouped = group_transactions_for_context(records)
    anomalies: List[Dict[str, Any]] = []

    for context_key, members in grouped.items():
        amounts = [member["amount"] for member in members if member["amount"] is not None and member["amount"] > 0]
        if len(amounts) < 10:
            continue
        sorted_amounts = sorted(float(value) for value in amounts)
        median = percentile(sorted_amounts, 50)
        p10 = percentile(sorted_amounts, 10)
        if median <= 0:
            continue

        floor_amount = median * SMALL_TRANSACTION_FLOOR_RATIO
        small_values = [value for value in sorted_amounts if value <= floor_amount]
        rare_small_signal = (len(small_values) / len(sorted_amounts)) <= 0.18
        if not rare_small_signal:
            continue

        for member in members:
            amount = member["amount"]
            if amount is None or amount <= 0:
                continue
            if not (amount < floor_amount and amount <= p10):
                continue

            deviation = percent_deviation(amount, median)
            severity = "medium" if amount < floor_amount * 0.5 else "low"
            anomalies.append(
                build_anomaly(
                    entity_type="transaction",
                    record_ids=[member["transaction_id"]],
                    anomaly_type="small_transaction",
                    severity=severity,
                    confidence=confidence_from_score((median / max(amount, 0.01)), floor=0.52, cap=0.9),
                    title="Unusually small transaction in context",
                    description=(
                        "Transaction is much smaller than normal for this account/category context "
                        "and small-value events are uncommon in this group."
                    ),
                    reasons=[
                        f"Observed {format_currency(amount)} vs median {format_currency(median)}.",
                        f"Small-value floor ratio configured at {SMALL_TRANSACTION_FLOOR_RATIO}.",
                    ],
                    suggested_action="review",
                    metrics={
                        "actual_value": round(amount, 2),
                        "expected_value": round(median, 2),
                        "percent_deviation": round(deviation, 2) if deviation is not None else None,
                        "z_score": None,
                    },
                    detected_at=detected_at,
                    source_table="transactions",
                    details={
                        "context_key": context_key,
                        "baseline": {
                            "median": round(median, 2),
                            "p10": round(p10, 2),
                            "floor_amount": round(floor_amount, 2),
                        },
                        "transaction": compact_record_snapshot(member["raw"]),
                    },
                )
            )

    LOGGER.info("Detected %d small suspicious transaction anomalies", len(anomalies))
    return anomalies


def group_transactions_for_context(records: Sequence[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    rows = normalize_transaction_rows(records)
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in rows:
        amount = row.get("amount")
        if amount is None:
            continue
        account_key = normalize_string(row.get("account_key")) or "unknown-account"
        category = normalize_string(row.get("category")) or "unknown-category"
        key = f"{account_key}|{category}"
        grouped[key].append(row)
    return grouped


def normalize_employee_rows(records: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for index, record in enumerate(records):
        employee_id = extract_first_string(record, EMPLOYEE_ID_FIELDS)
        if not employee_id:
            employee_id = f"employee-{index + 1}"

        first_name = extract_first_string(record, EMPLOYEE_FIRST_NAME_FIELDS)
        last_name = extract_first_string(record, EMPLOYEE_LAST_NAME_FIELDS)
        full_name = extract_first_string(record, EMPLOYEE_NAME_FIELDS)
        if not full_name and (first_name or last_name):
            full_name = " ".join(part for part in [first_name, last_name] if part).strip()

        row = {
            "employee_id": employee_id,
            "email": normalize_string(extract_first_string(record, EMPLOYEE_EMAIL_FIELDS)),
            "full_name": full_name or "",
            "department": extract_first_string(record, EMPLOYEE_DEPARTMENT_FIELDS),
            "role": extract_first_string(record, EMPLOYEE_ROLE_FIELDS),
            "hire_date": extract_first_date(record, EMPLOYEE_HIRE_DATE_FIELDS),
            "salary": extract_first_float(record, EMPLOYEE_SALARY_FIELDS),
            "raw": record,
        }
        rows.append(row)
    return rows


def normalize_transaction_rows(records: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for index, record in enumerate(records):
        transaction_id = extract_first_string(record, TRANSACTION_ID_FIELDS)
        if not transaction_id:
            transaction_id = f"txn-{index + 1}"

        amount = extract_first_float(record, TRANSACTION_AMOUNT_FIELDS)
        if amount is None:
            credit = parse_float(record.get("credit"))
            debit = parse_float(record.get("debit"))
            if credit is not None or debit is not None:
                amount = abs((credit or 0.0) - (debit or 0.0))
        if amount is not None:
            amount = abs(float(amount))

        row = {
            "transaction_id": transaction_id,
            "account_key": extract_first_string(record, TRANSACTION_ACCOUNT_FIELDS),
            "vendor": extract_first_string(record, TRANSACTION_VENDOR_FIELDS),
            "category": extract_first_string(record, TRANSACTION_CATEGORY_FIELDS),
            "timestamp": extract_first_datetime(record, DATE_FIELDS),
            "amount": amount,
            "raw": record,
        }
        rows.append(row)
    return rows


def build_anomaly(
    *,
    entity_type: str,
    record_ids: Sequence[str],
    anomaly_type: str,
    severity: str,
    confidence: float,
    title: str,
    description: str,
    reasons: Sequence[str],
    suggested_action: str,
    metrics: Dict[str, Any],
    detected_at: datetime,
    source_table: str,
    details: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    payload = {
        "anomaly_id": str(uuid.uuid4()),
        "entity_type": entity_type,
        "record_ids": [str(value) for value in record_ids if str(value).strip()],
        "anomaly_type": anomaly_type,
        "severity": severity,
        "confidence": round(max(0.0, min(1.0, confidence)), 3),
        "title": title,
        "description": description,
        "reasons": [str(reason) for reason in reasons if str(reason).strip()],
        "status": "new",
        "suggested_action": suggested_action,
        "metrics": {
            "actual_value": metrics.get("actual_value"),
            "expected_value": metrics.get("expected_value"),
            "percent_deviation": metrics.get("percent_deviation"),
            "z_score": metrics.get("z_score"),
        },
        "detected_at": detected_at.isoformat(),
        "source_table": source_table,
        "audit_trail": [],
    }
    if details:
        payload["details"] = details
    return payload


def deduplicate_anomalies(anomalies: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    deduplicated: List[Dict[str, Any]] = []
    signatures: set[Tuple[str, Tuple[str, ...], str]] = set()
    for anomaly in anomalies:
        signature = (
            str(anomaly.get("anomaly_type") or ""),
            tuple(sorted(str(item) for item in anomaly.get("record_ids", []))),
            str(anomaly.get("source_table") or ""),
        )
        if signature in signatures:
            continue
        signatures.add(signature)
        deduplicated.append(anomaly)
    return deduplicated


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


def extract_first_float(record: Dict[str, Any], fields: Sequence[str]) -> Optional[float]:
    for field in fields:
        if field not in record:
            continue
        parsed = parse_float(record.get(field))
        if parsed is not None:
            return parsed
    return None


def extract_first_datetime(record: Dict[str, Any], fields: Sequence[str]) -> Optional[datetime]:
    for field in fields:
        if field not in record:
            continue
        parsed = parse_datetime(record.get(field))
        if parsed is not None:
            return parsed
    source_modified = record.get("_source_last_modified")
    if source_modified:
        return parse_datetime(source_modified)
    return None


def extract_first_date(record: Dict[str, Any], fields: Sequence[str]) -> Optional[date]:
    parsed_dt = extract_first_datetime(record, fields)
    if parsed_dt is None:
        return None
    return parsed_dt.date()


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


def normalize_string(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip().lower()


def normalize_name(value: Any) -> str:
    text = normalize_string(value)
    if not text:
        return ""
    text = re.sub(r"[^a-z0-9 ]+", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def compact_record_snapshot(record: Dict[str, Any], max_fields: int = 12) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for key in sorted(record.keys()):
        if key.startswith("_"):
            continue
        if len(result) >= max_fields:
            break
        result[key] = record[key]
    return result


def percentile(values: Sequence[float], percentile_value: float) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return float(values[0])
    ordered = sorted(float(item) for item in values)
    rank = (len(ordered) - 1) * (percentile_value / 100.0)
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = rank - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * fraction


def standard_deviation(values: Sequence[float], mean: float) -> float:
    if not values:
        return 0.0
    variance = sum((float(item) - mean) ** 2 for item in values) / len(values)
    return variance ** 0.5


def percent_deviation(actual: Optional[float], expected: Optional[float]) -> Optional[float]:
    if actual is None or expected is None:
        return None
    if expected == 0:
        return None
    return ((actual - expected) / abs(expected)) * 100.0


def confidence_from_score(score: float, floor: float, cap: float) -> float:
    adjusted = floor + min(score, 8.0) * 0.06
    return max(floor, min(cap, adjusted))


def classify_salary_outlier_severity(abs_z_score: float, abs_deviation_percent: float) -> str:
    if abs_z_score >= max(3.6, SALARY_OUTLIER_ZSCORE_THRESHOLD + 1.0) or abs_deviation_percent >= 120:
        return "high"
    if abs_z_score >= SALARY_OUTLIER_ZSCORE_THRESHOLD or abs_deviation_percent >= 60:
        return "medium"
    return "low"


def describe_employee_group(member: Dict[str, Any], group_key: str) -> str:
    department = member.get("department") or ""
    role = member.get("role") or ""
    if department and role:
        return f"{department} / {role}"
    if department:
        return str(department)
    if role:
        return str(role)
    if group_key and group_key != "__all__":
        return group_key
    return "all employees"


def format_currency(value: float) -> str:
    return f"${value:,.2f}"
