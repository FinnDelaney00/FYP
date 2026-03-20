from __future__ import annotations

import math
import os
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence

import boto3


cloudwatch_client = boto3.client("cloudwatch")
logs_client = boto3.client("logs")
dms_client = boto3.client("dms")
s3_client = boto3.client("s3")

STATUS_PRIORITY = {
    "healthy": 0,
    "warning": 1,
    "degraded": 2,
    "down": 3,
}

SEVERITY_PRIORITY = {
    "low": 0,
    "medium": 1,
    "high": 2,
    "critical": 3,
}


def _schedule_target_minutes(expression: Optional[str], default_minutes: int) -> int:
    raw = str(expression or "").strip().lower()
    if not raw.startswith("rate(") or not raw.endswith(")"):
        return default_minutes

    inner = raw[5:-1].strip()
    match = re.match(r"(?P<count>\d+)\s+(?P<unit>minute|minutes|hour|hours)", inner)
    if not match:
        return default_minutes

    count = int(match.group("count"))
    unit = match.group("unit")
    minutes = count if unit.startswith("minute") else count * 60
    return int(math.ceil(minutes * 1.5))


DATA_LAKE_BUCKET = os.environ.get("DATA_LAKE_BUCKET", "").strip()
NAME_PREFIX = os.environ.get("NAME_PREFIX", "smartstream")
ALARM_NAME_PREFIX = os.environ.get("OPS_ALARM_NAME_PREFIX", NAME_PREFIX).strip() or NAME_PREFIX
EMPLOYEE_TRUSTED_PREFIX = os.environ.get("EMPLOYEE_TRUSTED_PREFIX", "").strip()
FINANCE_TRUSTED_PREFIX = os.environ.get("FINANCE_TRUSTED_PREFIX", "").strip()
PREDICTIONS_PREFIX = os.environ.get("PREDICTIONS_PREFIX", "").strip()
ANOMALIES_PREFIX = os.environ.get("ANOMALIES_PREFIX", "").strip()
TRUSTED_ROOT_PREFIX = os.environ.get("TRUSTED_ROOT_PREFIX", "trusted/").strip()
TRUSTED_ANALYTICS_ROOT_PREFIX = os.environ.get("TRUSTED_ANALYTICS_ROOT_PREFIX", "trusted-analytics/").strip()
KINESIS_STREAM_NAME = os.environ.get("KINESIS_STREAM_NAME", "").strip()
FIREHOSE_DELIVERY_STREAM_NAME = os.environ.get("FIREHOSE_DELIVERY_STREAM_NAME", "").strip()
DMS_PUBLIC_TASK_ID = os.environ.get("DMS_PUBLIC_TASK_ID", "").strip()
DMS_FINANCE_TASK_ID = os.environ.get("DMS_FINANCE_TASK_ID", "").strip()
TRANSFORM_LAMBDA_NAME = os.environ.get("TRANSFORM_LAMBDA_NAME", "").strip()
ML_LAMBDA_NAME = os.environ.get("ML_LAMBDA_NAME", "").strip()
ANOMALY_LAMBDA_NAME = os.environ.get("ANOMALY_LAMBDA_NAME", "").strip()
LIVE_API_LAMBDA_NAME = os.environ.get("LIVE_API_LAMBDA_NAME", "").strip()
TRANSFORM_TIMEOUT_MS = int(os.environ.get("TRANSFORM_TIMEOUT_MS", "300000"))
ML_TIMEOUT_MS = int(os.environ.get("ML_TIMEOUT_MS", "900000"))
ANOMALY_TIMEOUT_MS = int(os.environ.get("ANOMALY_TIMEOUT_MS", "900000"))
LIVE_API_TIMEOUT_MS = int(os.environ.get("LIVE_API_TIMEOUT_MS", "30000"))
INGESTION_FRESHNESS_TARGET_MINUTES = int(os.environ.get("INGESTION_FRESHNESS_TARGET_MINUTES", "15"))
FORECAST_FRESHNESS_TARGET_MINUTES = int(
    os.environ.get(
        "FORECAST_FRESHNESS_TARGET_MINUTES",
        str(_schedule_target_minutes(os.environ.get("ML_SCHEDULE_EXPRESSION"), 90)),
    )
)
ANOMALY_FRESHNESS_TARGET_MINUTES = int(
    os.environ.get(
        "ANOMALY_FRESHNESS_TARGET_MINUTES",
        str(_schedule_target_minutes(os.environ.get("ANOMALY_SCHEDULE_EXPRESSION"), 180)),
    )
)
METRIC_LOOKBACK_MINUTES = int(os.environ.get("OPS_METRIC_LOOKBACK_MINUTES", "180"))
LOG_LOOKBACK_MINUTES = int(os.environ.get("OPS_LOG_LOOKBACK_MINUTES", "240"))
LOG_SUMMARY_WINDOW_MINUTES = int(os.environ.get("OPS_LOG_SUMMARY_WINDOW_MINUTES", "15"))


def build_ops_snapshot() -> Dict[str, Any]:
    warnings: List[str] = []
    now = datetime.now(timezone.utc)

    freshness = {
        "employees": _load_s3_prefix_freshness(
            prefix=EMPLOYEE_TRUSTED_PREFIX or _join_prefix(TRUSTED_ROOT_PREFIX, "employees"),
            target_minutes=INGESTION_FRESHNESS_TARGET_MINUTES,
            label="trusted employees",
            warnings=warnings,
        ),
        "finance": _load_s3_prefix_freshness(
            prefix=FINANCE_TRUSTED_PREFIX or _join_prefix(TRUSTED_ROOT_PREFIX, "finance/transactions"),
            target_minutes=INGESTION_FRESHNESS_TARGET_MINUTES,
            label="trusted finance",
            warnings=warnings,
        ),
        "predictions": _load_s3_prefix_freshness(
            prefix=PREDICTIONS_PREFIX or _join_prefix(TRUSTED_ANALYTICS_ROOT_PREFIX, "predictions"),
            target_minutes=FORECAST_FRESHNESS_TARGET_MINUTES,
            label="trusted predictions",
            warnings=warnings,
        ),
        "anomalies": _load_s3_prefix_freshness(
            prefix=ANOMALIES_PREFIX or _join_prefix(TRUSTED_ANALYTICS_ROOT_PREFIX, "anomalies"),
            target_minutes=ANOMALY_FRESHNESS_TARGET_MINUTES,
            label="trusted anomalies",
            warnings=warnings,
        ),
    }
    dms_signals = {
        "public": _load_dms_task_signal(DMS_PUBLIC_TASK_ID, "Public schema CDC task", warnings),
        "finance": _load_dms_task_signal(DMS_FINANCE_TASK_ID, "Finance CDC task", warnings),
    }
    kinesis_signal = _load_kinesis_signal(warnings)
    firehose_signal = _load_firehose_signal(warnings)
    lambda_signals = {
        "transform": _load_lambda_signal(
            TRANSFORM_LAMBDA_NAME,
            timeout_ms=TRANSFORM_TIMEOUT_MS,
            service_label="Transform Lambda",
            warnings=warnings,
        ),
        "ml": _load_lambda_signal(
            ML_LAMBDA_NAME,
            timeout_ms=ML_TIMEOUT_MS,
            service_label="ML Lambda",
            warnings=warnings,
        ),
        "anomaly": _load_lambda_signal(
            ANOMALY_LAMBDA_NAME,
            timeout_ms=ANOMALY_TIMEOUT_MS,
            service_label="Anomaly Lambda",
            warnings=warnings,
        ),
        "live_api": _load_lambda_signal(
            LIVE_API_LAMBDA_NAME,
            timeout_ms=LIVE_API_TIMEOUT_MS,
            service_label="Live API Lambda",
            warnings=warnings,
            required=False,
        ),
    }
    alarms = _load_active_alarms(warnings)
    logs = _load_logs(warnings)
    pipelines = _build_pipeline_models(
        freshness=freshness,
        dms_signals=dms_signals,
        kinesis_signal=kinesis_signal,
        firehose_signal=firehose_signal,
        lambda_signals=lambda_signals,
        alarms=alarms,
        logs=logs,
    )
    log_summary = _build_log_summary(logs)

    return {
        "overview": {
            "total_pipelines": len(pipelines["summaries"]),
            "healthy": sum(1 for row in pipelines["summaries"] if row["overall_status"] == "healthy"),
            "degraded": sum(
                1 for row in pipelines["summaries"] if row["overall_status"] in {"warning", "degraded"}
            ),
            "down": sum(1 for row in pipelines["summaries"] if row["overall_status"] == "down"),
            "active_alarms": len(alarms),
            "last_updated": now.isoformat(),
        },
        "pipelines": pipelines["summaries"],
        "pipeline_details": pipelines["details"],
        "alarms": alarms,
        "log_summary": log_summary,
        "meta": {
            "source": "live",
            "partial_data": bool(warnings),
            "warnings": warnings,
            "generated_at": now.isoformat(),
        },
    }


def _build_pipeline_models(
    *,
    freshness: Dict[str, Dict[str, Any]],
    dms_signals: Dict[str, Dict[str, Any]],
    kinesis_signal: Dict[str, Any],
    firehose_signal: Dict[str, Any],
    lambda_signals: Dict[str, Dict[str, Any]],
    alarms: Sequence[Dict[str, Any]],
    logs: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    alarms_by_pipeline = defaultdict(list)
    for alarm in alarms:
        if alarm.get("pipeline_id"):
            alarms_by_pipeline[alarm["pipeline_id"]].append(alarm)

    recent_errors_by_pipeline = _group_recent_errors_by_pipeline(logs)

    employee_components = [
        _component_from_signal("PostgreSQL public CDC", dms_signals["public"], area="Source"),
        _component_from_signal("Kinesis ingest stream", kinesis_signal, area="Ingestion"),
        _component_from_signal("Firehose delivery stream", firehose_signal, area="Ingestion"),
        _component_from_signal("Transform Lambda", lambda_signals["transform"], area="Processing"),
        _component_from_freshness("Trusted employees dataset", freshness["employees"], area="Delivery"),
    ]
    finance_components = [
        _component_from_signal("Finance schema CDC", dms_signals["finance"], area="Source"),
        _component_from_signal("Kinesis ingest stream", kinesis_signal, area="Ingestion"),
        _component_from_signal("Firehose delivery stream", firehose_signal, area="Ingestion"),
        _component_from_signal("Transform Lambda", lambda_signals["transform"], area="Processing"),
        _component_from_freshness("Trusted finance dataset", freshness["finance"], area="Delivery"),
    ]
    forecast_components = [
        _component_from_freshness("Trusted employees input", freshness["employees"], area="Source"),
        _component_from_freshness("Trusted finance input", freshness["finance"], area="Source"),
        _component_from_signal("ML forecast Lambda", lambda_signals["ml"], area="Processing"),
        _component_from_freshness("Predictions dataset", freshness["predictions"], area="Delivery"),
    ]
    anomaly_components = [
        _component_from_freshness("Predictions input", freshness["predictions"], area="Source"),
        _component_from_signal("Anomaly Lambda", lambda_signals["anomaly"], area="Processing"),
        _component_from_freshness("Anomalies dataset", freshness["anomalies"], area="Delivery"),
    ]

    if lambda_signals["live_api"].get("resource"):
        forecast_components.append(
            _component_from_signal("Live API forecasts route", lambda_signals["live_api"], area="Serving")
        )
        anomaly_components.append(
            _component_from_signal("Live API anomalies route", lambda_signals["live_api"], area="Serving")
        )

    pipeline_specs = [
        {
            "id": "employee-pipeline",
            "name": "Employee pipeline",
            "source_status": _worst_status(
                [dms_signals["public"]["status"], kinesis_signal["status"], firehose_signal["status"]]
            ),
            "processing_status": lambda_signals["transform"]["status"],
            "delivery_status": freshness["employees"]["status"],
            "freshness": freshness["employees"],
            "components": employee_components,
            "last_success_at": _resolve_last_success(
                freshness["employees"].get("last_success_at"),
                lambda_signals["transform"].get("last_success_at"),
                dms_signals["public"].get("last_success_at"),
            ),
        },
        {
            "id": "finance-pipeline",
            "name": "Finance pipeline",
            "source_status": _worst_status(
                [dms_signals["finance"]["status"], kinesis_signal["status"], firehose_signal["status"]]
            ),
            "processing_status": lambda_signals["transform"]["status"],
            "delivery_status": freshness["finance"]["status"],
            "freshness": freshness["finance"],
            "components": finance_components,
            "last_success_at": _resolve_last_success(
                freshness["finance"].get("last_success_at"),
                lambda_signals["transform"].get("last_success_at"),
                dms_signals["finance"].get("last_success_at"),
            ),
        },
        {
            "id": "forecast-pipeline",
            "name": "Forecast pipeline",
            "source_status": _worst_status([freshness["employees"]["status"], freshness["finance"]["status"]]),
            "processing_status": lambda_signals["ml"]["status"],
            "delivery_status": freshness["predictions"]["status"],
            "freshness": freshness["predictions"],
            "components": forecast_components,
            "last_success_at": _resolve_last_success(
                freshness["predictions"].get("last_success_at"),
                lambda_signals["ml"].get("last_success_at"),
            ),
        },
        {
            "id": "anomaly-pipeline",
            "name": "Anomaly pipeline",
            "source_status": freshness["predictions"]["status"],
            "processing_status": lambda_signals["anomaly"]["status"],
            "delivery_status": freshness["anomalies"]["status"],
            "freshness": freshness["anomalies"],
            "components": anomaly_components,
            "last_success_at": _resolve_last_success(
                freshness["anomalies"].get("last_success_at"),
                lambda_signals["anomaly"].get("last_success_at"),
            ),
        },
    ]

    summaries = []
    details = {}

    for spec in pipeline_specs:
        active_alarms = alarms_by_pipeline[spec["id"]]
        recent_errors = recent_errors_by_pipeline[spec["id"]]
        freshness_status = spec["freshness"]["status"]
        overall_status = _worst_status(
            [
                spec["source_status"],
                spec["processing_status"],
                spec["delivery_status"],
                freshness_status,
                *["down" if alarm["severity"] == "critical" else "degraded" for alarm in active_alarms],
            ]
        )
        last_failure_at = _latest_timestamp(
            [*(item.get("timestamp") for item in recent_errors), *(item.get("triggered_at") for item in active_alarms)]
        )
        recent_error_summary = recent_errors[0]["summary"] if recent_errors else ""
        impacted_resources = _impacted_resources(spec["components"], active_alarms)
        summary_text = _pipeline_summary_text(
            name=spec["name"],
            overall_status=overall_status,
            active_alarms=active_alarms,
            recent_error_summary=recent_error_summary,
            freshness=spec["freshness"],
        )

        summary = {
            "id": spec["id"],
            "name": spec["name"],
            "status": overall_status,
            "overall_status": overall_status,
            "sourceStatus": spec["source_status"],
            "source_status": spec["source_status"],
            "ingestionStatus": spec["source_status"],
            "ingestion_status": spec["source_status"],
            "processingStatus": spec["processing_status"],
            "processing_status": spec["processing_status"],
            "deliveryStatus": spec["delivery_status"],
            "delivery_status": spec["delivery_status"],
            "freshnessStatus": freshness_status,
            "freshness_status": freshness_status,
            "lastSuccessfulEventAt": spec["last_success_at"],
            "last_success_at": spec["last_success_at"],
            "activeAlarmCount": len(active_alarms),
            "alarm_count": len(active_alarms),
            "recentErrorSummary": recent_error_summary,
            "recent_error_summary": recent_error_summary,
            "statusHistory": [overall_status] * 12,
            "status_history": [overall_status] * 12,
        }
        detail = {
            "id": spec["id"],
            "name": spec["name"],
            "status": overall_status,
            "overall_status": overall_status,
            "summary": summary_text,
            "freshness": {
                "status": freshness_status,
                "lag_minutes": spec["freshness"].get("lag_minutes"),
                "target_minutes": spec["freshness"].get("target_minutes"),
                "message": spec["freshness"].get("message"),
            },
            "lastSuccessfulEventAt": spec["last_success_at"],
            "last_success_at": spec["last_success_at"],
            "lastFailureAt": last_failure_at,
            "last_failure_at": last_failure_at,
            "components": spec["components"],
            "recentErrors": recent_errors,
            "recent_errors": recent_errors,
            "activeAlarms": active_alarms,
            "active_alarms": active_alarms,
            "impactedResources": impacted_resources,
            "impacted_resources": impacted_resources,
        }

        summaries.append(summary)
        details[spec["id"]] = detail

    return {
        "summaries": summaries,
        "details": details,
    }


def _pipeline_summary_text(
    *,
    name: str,
    overall_status: str,
    active_alarms: Sequence[Dict[str, Any]],
    recent_error_summary: str,
    freshness: Dict[str, Any],
) -> str:
    if overall_status == "healthy":
        return f"{name} is healthy and operating inside its expected freshness targets."

    parts = []
    if active_alarms:
        parts.append(f"{len(active_alarms)} active alarm(s)")
    if freshness.get("lag_minutes") is not None and freshness.get("target_minutes") is not None:
        parts.append(
            f"freshness lag {int(round(float(freshness['lag_minutes'])))}m against a {int(round(float(freshness['target_minutes'])))}m target"
        )
    if recent_error_summary:
        parts.append(recent_error_summary.rstrip("."))

    body = "; ".join(parts) if parts else "recent telemetry indicates degraded health"
    return f"{name} is {overall_status}. {body}."


def _group_recent_errors_by_pipeline(log_payload: Dict[str, Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    grouped = defaultdict(list)
    for service in log_payload.values():
        for event in service.get("recent_errors", []):
            for pipeline_id in event.get("pipeline_ids", []):
                grouped[pipeline_id].append(
                    {
                        "timestamp": event.get("timestamp"),
                        "service": service.get("service"),
                        "summary": event.get("summary"),
                    }
                )

    for pipeline_id, items in grouped.items():
        items.sort(key=lambda item: item.get("timestamp") or "", reverse=True)
        grouped[pipeline_id] = items[:5]

    return grouped


def _load_logs(warnings: List[str]) -> Dict[str, Dict[str, Any]]:
    configs = []
    if DMS_PUBLIC_TASK_ID:
        configs.append(
            {
                "service": "dms-public-task",
                "log_group": f"/aws/dms/tasks/{DMS_PUBLIC_TASK_ID}",
                "pipeline_ids": ["employee-pipeline"],
            }
        )
    if DMS_FINANCE_TASK_ID:
        configs.append(
            {
                "service": "dms-finance-task",
                "log_group": f"/aws/dms/tasks/{DMS_FINANCE_TASK_ID}",
                "pipeline_ids": ["finance-pipeline"],
            }
        )
    if TRANSFORM_LAMBDA_NAME:
        configs.append(
            {
                "service": "transform-lambda",
                "log_group": f"/aws/lambda/{TRANSFORM_LAMBDA_NAME}",
                "pipeline_ids": ["employee-pipeline", "finance-pipeline"],
            }
        )
    if ML_LAMBDA_NAME:
        configs.append(
            {
                "service": "forecast-ml-lambda",
                "log_group": f"/aws/lambda/{ML_LAMBDA_NAME}",
                "pipeline_ids": ["forecast-pipeline"],
            }
        )
    if ANOMALY_LAMBDA_NAME:
        configs.append(
            {
                "service": "anomaly-lambda",
                "log_group": f"/aws/lambda/{ANOMALY_LAMBDA_NAME}",
                "pipeline_ids": ["anomaly-pipeline"],
            }
        )
    if LIVE_API_LAMBDA_NAME:
        configs.append(
            {
                "service": "live-api",
                "log_group": f"/aws/lambda/{LIVE_API_LAMBDA_NAME}",
                "pipeline_ids": ["forecast-pipeline", "anomaly-pipeline"],
            }
        )
    if FIREHOSE_DELIVERY_STREAM_NAME:
        configs.append(
            {
                "service": "firehose",
                "log_group": f"/aws/kinesisfirehose/{FIREHOSE_DELIVERY_STREAM_NAME}",
                "pipeline_ids": ["employee-pipeline", "finance-pipeline"],
            }
        )

    payload = {}
    now = datetime.now(timezone.utc)
    summary_start = int((now - timedelta(minutes=LOG_SUMMARY_WINDOW_MINUTES)).timestamp() * 1000)
    detail_start = int((now - timedelta(minutes=LOG_LOOKBACK_MINUTES)).timestamp() * 1000)
    filter_pattern = "?ERROR ?Error ?Exception ?WARN ?Warning ?FATAL"

    for config in configs:
        try:
            summary_response = logs_client.filter_log_events(
                logGroupName=config["log_group"],
                startTime=summary_start,
                filterPattern=filter_pattern,
                limit=50,
            )
            detail_response = logs_client.filter_log_events(
                logGroupName=config["log_group"],
                startTime=detail_start,
                filterPattern=filter_pattern,
                limit=20,
            )
        except Exception as exc:
            warnings.append(f"CloudWatch Logs unavailable for {config['service']}: {exc}")
            payload[config["service"]] = {
                "service": config["service"],
                "level": "INFO",
                "count_15m": 0,
                "latest_message": "No recent log events available.",
                "updated_at": None,
                "recent_errors": [],
            }
            continue

        summary_events = list(summary_response.get("events", []))
        detail_events = list(detail_response.get("events", []))
        detail_events.sort(key=lambda event: event.get("timestamp", 0), reverse=True)
        latest_event = detail_events[0] if detail_events else (summary_events[-1] if summary_events else None)
        latest_message = _compact_message(latest_event.get("message")) if latest_event else "No recent elevated logs."
        payload[config["service"]] = {
            "service": config["service"],
            "level": _log_level_from_message(latest_message),
            "count_15m": len(summary_events),
            "latest_message": latest_message,
            "updated_at": _millis_to_iso(latest_event.get("timestamp")) if latest_event else None,
            "recent_errors": [
                {
                    "timestamp": _millis_to_iso(event.get("timestamp")),
                    "summary": _compact_message(event.get("message")),
                    "pipeline_ids": config["pipeline_ids"],
                }
                for event in detail_events[:5]
            ],
        }

    return payload


def _build_log_summary(log_payload: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows = [
        {
            "service": item["service"],
            "level": item["level"],
            "count_15m": item["count_15m"],
            "latest_message": item["latest_message"],
            "updated_at": item["updated_at"],
        }
        for item in log_payload.values()
    ]
    rows.sort(key=lambda row: (-row["count_15m"], row["service"]))
    return rows


def _load_active_alarms(warnings: List[str]) -> List[Dict[str, Any]]:
    try:
        response = cloudwatch_client.describe_alarms(
            AlarmNamePrefix=ALARM_NAME_PREFIX,
            StateValue="ALARM",
        )
    except Exception as exc:
        warnings.append(f"CloudWatch alarms unavailable: {exc}")
        return []

    alarms = []
    for raw_alarm in list(response.get("MetricAlarms", [])) + list(response.get("CompositeAlarms", [])):
        alarms.extend(_normalize_alarm(raw_alarm))

    alarms.sort(key=lambda alarm: (-SEVERITY_PRIORITY.get(alarm["severity"], 0), alarm.get("triggered_at") or ""))
    return alarms


def _load_s3_prefix_freshness(
    *,
    prefix: str,
    target_minutes: int,
    label: str,
    warnings: List[str],
) -> Dict[str, Any]:
    resource = f"s3://{DATA_LAKE_BUCKET}/{prefix}" if DATA_LAKE_BUCKET and prefix else "s3:unconfigured"
    if not DATA_LAKE_BUCKET or not prefix:
        warnings.append(f"S3 freshness signal unavailable for {label}: missing bucket or prefix configuration.")
        return {
            "status": "down",
            "resource": resource,
            "lag_minutes": None,
            "target_minutes": target_minutes,
            "last_success_at": None,
            "message": f"No S3 freshness configuration is available for {label}.",
        }

    try:
        latest_object = _latest_s3_object(prefix)
    except Exception as exc:
        warnings.append(f"S3 freshness lookup failed for {label}: {exc}")
        latest_object = None

    if latest_object is None:
        return {
            "status": "down",
            "resource": resource,
            "lag_minutes": None,
            "target_minutes": target_minutes,
            "last_success_at": None,
            "message": f"No recent objects were found under {prefix}.",
        }

    last_modified = _coerce_datetime(latest_object["LastModified"])
    lag_minutes = max(0.0, (datetime.now(timezone.utc) - last_modified).total_seconds() / 60.0)
    return {
        "status": _freshness_status(lag_minutes, target_minutes),
        "resource": resource,
        "lag_minutes": round(lag_minutes, 2),
        "target_minutes": target_minutes,
        "last_success_at": last_modified.isoformat(),
        "message": f"Latest successful object under {prefix} arrived {_minutes_text(lag_minutes)} ago.",
    }


def _latest_s3_object(prefix: str) -> Optional[Dict[str, Any]]:
    paginator = s3_client.get_paginator("list_objects_v2")
    latest = None
    for page in paginator.paginate(Bucket=DATA_LAKE_BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj.get("Key") or ""
            if not key or key.endswith("/"):
                continue
            if latest is None or _coerce_datetime(obj["LastModified"]) > _coerce_datetime(latest["LastModified"]):
                latest = obj
    return latest


def _load_dms_task_signal(task_id: str, label: str, warnings: List[str]) -> Dict[str, Any]:
    resource = f"dms:{task_id}" if task_id else "dms:unconfigured"
    if not task_id:
        warnings.append(f"{label} is not configured for the ops API.")
        return {
            "status": "down",
            "resource": resource,
            "last_success_at": None,
            "detail": f"{label} is not configured.",
        }

    task_status = "unknown"
    stop_reason = ""

    try:
        response = dms_client.describe_replication_tasks(
            Filters=[{"Name": "replication-task-id", "Values": [task_id]}]
        )
        tasks = list(response.get("ReplicationTasks", []))
        if tasks:
            task = tasks[0]
            task_status = str(task.get("Status") or "unknown").lower()
            stop_reason = str(task.get("StopReason") or "").strip()
    except Exception as exc:
        warnings.append(f"DMS task lookup failed for {task_id}: {exc}")

    source_latency = _metric_value(
        namespace="AWS/DMS",
        metric_name="CDCLatencySource",
        dimensions={"ReplicationTaskIdentifier": task_id},
        statistic="Maximum",
        warnings=warnings,
        label=f"{task_id} source latency",
    )
    target_latency = _metric_value(
        namespace="AWS/DMS",
        metric_name="CDCLatencyTarget",
        dimensions={"ReplicationTaskIdentifier": task_id},
        statistic="Maximum",
        warnings=warnings,
        label=f"{task_id} target latency",
    )

    latency_status = _latency_status(
        max(_safe_number(source_latency["value"]), _safe_number(target_latency["value"])),
        warning=60,
        degraded=300,
        down=900,
    )
    task_state_status = _dms_task_state_status(task_status)
    detail = f"{label} is {task_status or 'unknown'}."
    if source_latency["value"] is not None or target_latency["value"] is not None:
        detail = (
            f"{detail} source latency {_seconds_text(source_latency['value'])}; "
            f"target latency {_seconds_text(target_latency['value'])}."
        )
    if stop_reason:
        detail = f"{detail} {stop_reason}"

    return {
        "status": _worst_status([task_state_status, latency_status]),
        "resource": resource,
        "last_success_at": _resolve_last_success(source_latency["timestamp"], target_latency["timestamp"]),
        "detail": detail,
    }


def _load_kinesis_signal(warnings: List[str]) -> Dict[str, Any]:
    resource = f"kinesis:{KINESIS_STREAM_NAME}" if KINESIS_STREAM_NAME else "kinesis:unconfigured"
    if not KINESIS_STREAM_NAME:
        warnings.append("Kinesis stream name is not configured for the ops API.")
        return {
            "status": "down",
            "resource": resource,
            "last_success_at": None,
            "detail": "Kinesis stream configuration is missing.",
        }

    iterator_age = _metric_value(
        namespace="AWS/Kinesis",
        metric_name="GetRecords.IteratorAgeMilliseconds",
        dimensions={"StreamName": KINESIS_STREAM_NAME},
        statistic="Maximum",
        warnings=warnings,
        label="Kinesis iterator age",
    )
    throttles = _metric_value(
        namespace="AWS/Kinesis",
        metric_name="WriteProvisionedThroughputExceeded",
        dimensions={"StreamName": KINESIS_STREAM_NAME},
        statistic="Sum",
        warnings=warnings,
        label="Kinesis write throttles",
    )
    incoming_records = _metric_value(
        namespace="AWS/Kinesis",
        metric_name="IncomingRecords",
        dimensions={"StreamName": KINESIS_STREAM_NAME},
        statistic="Sum",
        warnings=warnings,
        label="Kinesis incoming records",
    )

    iterator_status = _latency_status(
        _safe_number(iterator_age["value"], divisor=1000.0),
        warning=30,
        degraded=120,
        down=300,
    )
    throttle_value = _safe_number(throttles["value"])
    if throttle_value >= 50:
        throttle_status = "down"
    elif throttle_value >= 10:
        throttle_status = "degraded"
    elif throttle_value > 0:
        throttle_status = "warning"
    else:
        throttle_status = "healthy"

    return {
        "status": _worst_status([iterator_status, throttle_status]),
        "resource": resource,
        "last_success_at": _resolve_last_success(iterator_age["timestamp"], incoming_records["timestamp"]),
        "detail": (
            f"Kinesis iterator age is {_seconds_text(_safe_number(iterator_age['value'], divisor=1000.0))}; "
            f"write throttles: {int(round(throttle_value))}; "
            f"incoming records: {int(round(_safe_number(incoming_records['value'])))}."
        ),
    }


def _load_firehose_signal(warnings: List[str]) -> Dict[str, Any]:
    resource = f"firehose:{FIREHOSE_DELIVERY_STREAM_NAME}" if FIREHOSE_DELIVERY_STREAM_NAME else "firehose:unconfigured"
    if not FIREHOSE_DELIVERY_STREAM_NAME:
        warnings.append("Firehose delivery stream name is not configured for the ops API.")
        return {
            "status": "down",
            "resource": resource,
            "last_success_at": None,
            "detail": "Firehose delivery stream configuration is missing.",
        }

    freshness = _metric_value(
        namespace="AWS/Firehose",
        metric_name="DeliveryToS3.DataFreshness",
        dimensions={"DeliveryStreamName": FIREHOSE_DELIVERY_STREAM_NAME},
        statistic="Maximum",
        warnings=warnings,
        label="Firehose S3 freshness",
    )
    success = _metric_value(
        namespace="AWS/Firehose",
        metric_name="DeliveryToS3.Success",
        dimensions={"DeliveryStreamName": FIREHOSE_DELIVERY_STREAM_NAME},
        statistic="Sum",
        warnings=warnings,
        label="Firehose S3 delivery success",
    )

    return {
        "status": _latency_status(_safe_number(freshness["value"]), warning=300, degraded=900, down=1800),
        "resource": resource,
        "last_success_at": _resolve_last_success(freshness["timestamp"], success["timestamp"]),
        "detail": (
            f"Firehose S3 freshness is {_seconds_text(freshness['value'])}; "
            f"successful delivery datapoints: {int(round(_safe_number(success['value'])))}."
        ),
    }


def _load_lambda_signal(
    function_name: str,
    *,
    timeout_ms: int,
    service_label: str,
    warnings: List[str],
    required: bool = True,
) -> Dict[str, Any]:
    resource = f"lambda:{function_name}" if function_name else ""
    if not function_name:
        if required:
            warnings.append(f"{service_label} name is not configured for the ops API.")
        return {
            "status": "down" if required else "healthy",
            "resource": resource,
            "last_success_at": None,
            "detail": f"{service_label} is not configured.",
        }

    invocations = _metric_value(
        namespace="AWS/Lambda",
        metric_name="Invocations",
        dimensions={"FunctionName": function_name},
        statistic="Sum",
        warnings=warnings,
        label=f"{service_label} invocations",
    )
    errors = _metric_value(
        namespace="AWS/Lambda",
        metric_name="Errors",
        dimensions={"FunctionName": function_name},
        statistic="Sum",
        warnings=warnings,
        label=f"{service_label} errors",
    )
    duration = _metric_value(
        namespace="AWS/Lambda",
        metric_name="Duration",
        dimensions={"FunctionName": function_name},
        statistic="Average",
        warnings=warnings,
        label=f"{service_label} duration",
    )
    throttles = _metric_value(
        namespace="AWS/Lambda",
        metric_name="Throttles",
        dimensions={"FunctionName": function_name},
        statistic="Sum",
        warnings=warnings,
        label=f"{service_label} throttles",
    )

    invocations_value = _safe_number(invocations["value"])
    errors_value = _safe_number(errors["value"])
    throttles_value = _safe_number(throttles["value"])
    duration_value = _safe_number(duration["value"])
    error_rate = 0.0 if invocations_value <= 0 else errors_value / max(invocations_value, 1.0)

    if invocations_value > 0 and errors_value >= invocations_value and errors_value >= 1:
        error_status = "down"
    elif errors_value >= 5 or error_rate >= 0.25:
        error_status = "degraded"
    elif errors_value >= 1:
        error_status = "warning"
    else:
        error_status = "healthy"

    if throttles_value >= 3:
        throttle_status = "down"
    elif throttles_value >= 1:
        throttle_status = "degraded"
    else:
        throttle_status = "healthy"

    ratio = 0.0 if timeout_ms <= 0 else duration_value / float(timeout_ms)
    if ratio >= 0.95:
        duration_status = "down"
    elif ratio >= 0.8:
        duration_status = "degraded"
    elif ratio >= 0.6:
        duration_status = "warning"
    else:
        duration_status = "healthy"

    return {
        "status": _worst_status([error_status, throttle_status, duration_status]),
        "resource": resource,
        "last_success_at": _resolve_last_success(invocations["timestamp"], duration["timestamp"]),
        "detail": (
            f"{service_label} ran {int(round(invocations_value))} time(s) with "
            f"{int(round(errors_value))} error(s), {int(round(throttles_value))} throttle(s), "
            f"and average duration {_milliseconds_text(duration_value)}."
        ),
    }


def _metric_value(
    *,
    namespace: str,
    metric_name: str,
    dimensions: Dict[str, str],
    statistic: str,
    warnings: List[str],
    label: str,
    lookback_minutes: int = METRIC_LOOKBACK_MINUTES,
    period: int = 300,
) -> Dict[str, Optional[Any]]:
    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(minutes=lookback_minutes)

    try:
        response = cloudwatch_client.get_metric_statistics(
            Namespace=namespace,
            MetricName=metric_name,
            Dimensions=[{"Name": key, "Value": value} for key, value in dimensions.items()],
            StartTime=start_time,
            EndTime=end_time,
            Period=period,
            Statistics=[statistic],
        )
    except Exception as exc:
        warnings.append(f"Metric lookup failed for {label}: {exc}")
        return {"value": None, "timestamp": None}

    datapoints = list(response.get("Datapoints", []))
    if not datapoints:
        return {"value": None, "timestamp": None}

    datapoints.sort(key=lambda point: point.get("Timestamp", datetime.min.replace(tzinfo=timezone.utc)))
    latest = datapoints[-1]
    return {
        "value": latest.get(statistic),
        "timestamp": _dt_to_iso(latest.get("Timestamp")),
    }


def _normalize_alarm(raw_alarm: Dict[str, Any]) -> List[Dict[str, Any]]:
    alarm_name = str(raw_alarm.get("AlarmName") or "")
    lowered = alarm_name.lower()
    pipeline_ids = _alarm_pipeline_ids(lowered) or [None]
    severity = _alarm_severity(lowered)
    resource = _alarm_resource(lowered)
    summary = str(raw_alarm.get("AlarmDescription") or raw_alarm.get("StateReason") or f"{alarm_name} is in ALARM")
    triggered_at = _dt_to_iso(raw_alarm.get("StateUpdatedTimestamp"))

    return [
        {
            "id": f"{alarm_name}:{pipeline_id or 'shared'}",
            "pipeline_id": pipeline_id,
            "pipeline_name": _pipeline_label(pipeline_id),
            "name": alarm_name,
            "severity": severity,
            "summary": summary,
            "resource": resource,
            "triggered_at": triggered_at,
            "state": "ALARM",
        }
        for pipeline_id in pipeline_ids
    ]


def _alarm_pipeline_ids(alarm_name_lower: str) -> List[Optional[str]]:
    if DMS_FINANCE_TASK_ID and DMS_FINANCE_TASK_ID.lower() in alarm_name_lower:
        return ["finance-pipeline"]
    if DMS_PUBLIC_TASK_ID and DMS_PUBLIC_TASK_ID.lower() in alarm_name_lower:
        return ["employee-pipeline"]
    if "finance" in alarm_name_lower:
        return ["finance-pipeline"]
    if "forecast" in alarm_name_lower or "prediction" in alarm_name_lower or "-ml-" in alarm_name_lower:
        return ["forecast-pipeline"]
    if "anomaly" in alarm_name_lower:
        return ["anomaly-pipeline"]
    if "kinesis" in alarm_name_lower or "firehose" in alarm_name_lower or "transform" in alarm_name_lower:
        return ["employee-pipeline", "finance-pipeline"]
    if "live-api" in alarm_name_lower:
        return ["forecast-pipeline", "anomaly-pipeline"]
    return []


def _alarm_severity(alarm_name_lower: str) -> str:
    if "pipeline-health" in alarm_name_lower or "anomaly" in alarm_name_lower:
        return "critical"
    if "errors" in alarm_name_lower or "failed" in alarm_name_lower or "latency" in alarm_name_lower:
        return "high"
    if "duration" in alarm_name_lower or "freshness" in alarm_name_lower or "iterator" in alarm_name_lower:
        return "medium"
    return "medium"


def _alarm_resource(alarm_name_lower: str) -> str:
    if DMS_PUBLIC_TASK_ID and DMS_PUBLIC_TASK_ID.lower() in alarm_name_lower:
        return f"dms:{DMS_PUBLIC_TASK_ID}"
    if DMS_FINANCE_TASK_ID and DMS_FINANCE_TASK_ID.lower() in alarm_name_lower:
        return f"dms:{DMS_FINANCE_TASK_ID}"
    if "kinesis" in alarm_name_lower:
        return f"kinesis:{KINESIS_STREAM_NAME}"
    if "firehose" in alarm_name_lower:
        return f"firehose:{FIREHOSE_DELIVERY_STREAM_NAME}"
    if "transform" in alarm_name_lower:
        return f"lambda:{TRANSFORM_LAMBDA_NAME}"
    if "ml" in alarm_name_lower or "forecast" in alarm_name_lower or "prediction" in alarm_name_lower:
        return f"lambda:{ML_LAMBDA_NAME}"
    if "anomaly" in alarm_name_lower:
        return f"lambda:{ANOMALY_LAMBDA_NAME}"
    if "live-api" in alarm_name_lower:
        return f"lambda:{LIVE_API_LAMBDA_NAME}"
    return f"cloudwatch:{alarm_name_lower}"


def _pipeline_label(pipeline_id: Optional[str]) -> str:
    if pipeline_id == "employee-pipeline":
        return "Employee pipeline"
    if pipeline_id == "finance-pipeline":
        return "Finance pipeline"
    if pipeline_id == "forecast-pipeline":
        return "Forecast pipeline"
    if pipeline_id == "anomaly-pipeline":
        return "Anomaly pipeline"
    return "Shared platform"


def _component_from_signal(name: str, signal: Dict[str, Any], *, area: str) -> Dict[str, Any]:
    return {
        "name": name,
        "area": area,
        "status": signal.get("status", "down"),
        "resource": signal.get("resource", "unavailable"),
        "detail": signal.get("detail", f"{name} has no recent telemetry."),
    }


def _component_from_freshness(name: str, signal: Dict[str, Any], *, area: str) -> Dict[str, Any]:
    return {
        "name": name,
        "area": area,
        "status": signal.get("status", "down"),
        "resource": signal.get("resource", "unavailable"),
        "detail": signal.get("message", f"{name} has no recent successful objects."),
    }


def _impacted_resources(components: Sequence[Dict[str, Any]], alarms: Sequence[Dict[str, Any]]) -> List[str]:
    resources = []
    for component in components:
        resource = component.get("resource")
        if resource and (component.get("status") != "healthy" or not resources) and resource not in resources:
            resources.append(resource)
    for alarm in alarms:
        resource = alarm.get("resource")
        if resource and resource not in resources:
            resources.append(resource)
    return resources


def _dms_task_state_status(task_status: str) -> str:
    normalized = str(task_status or "unknown").lower()
    if normalized in {"running", "starting", "ready"}:
        return "healthy"
    if normalized in {"stopping", "modifying", "moving"}:
        return "warning"
    if normalized == "stopped":
        return "degraded"
    return "down"


def _freshness_status(lag_minutes: Optional[float], target_minutes: int) -> str:
    if lag_minutes is None:
        return "down"
    if lag_minutes <= target_minutes:
        return "healthy"
    if lag_minutes <= target_minutes * 2:
        return "warning"
    if lag_minutes <= target_minutes * 4:
        return "degraded"
    return "down"


def _latency_status(value: Optional[float], *, warning: float, degraded: float, down: float) -> str:
    if value is None:
        return "down"
    if value >= down:
        return "down"
    if value >= degraded:
        return "degraded"
    if value >= warning:
        return "warning"
    return "healthy"


def _worst_status(statuses: Iterable[Optional[str]]) -> str:
    resolved = "healthy"
    for status in statuses:
        normalized = _normalize_status(status)
        if STATUS_PRIORITY[normalized] > STATUS_PRIORITY[resolved]:
            resolved = normalized
    return resolved


def _normalize_status(status: Optional[str]) -> str:
    normalized = str(status or "healthy").strip().lower()
    if normalized not in STATUS_PRIORITY:
        return "healthy"
    return normalized


def _resolve_last_success(*values: Optional[str]) -> Optional[str]:
    parsed = [_parse_iso(value) for value in values if value]
    if not parsed:
        return None
    return max(parsed).isoformat()


def _latest_timestamp(values: Iterable[Optional[str]]) -> Optional[str]:
    parsed = [_parse_iso(value) for value in values if value]
    if not parsed:
        return None
    return max(parsed).isoformat()


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)


def _coerce_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return _parse_iso(str(value))


def _dt_to_iso(value: Any) -> Optional[str]:
    if not value:
        return None
    return _coerce_datetime(value).isoformat()


def _millis_to_iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    return datetime.fromtimestamp(float(value) / 1000.0, tz=timezone.utc).isoformat()


def _safe_number(value: Any, *, divisor: float = 1.0) -> float:
    if value is None:
        return 0.0
    try:
        return float(value) / divisor
    except (TypeError, ValueError):
        return 0.0


def _seconds_text(value: Any) -> str:
    if value is None:
        return "n/a"
    return f"{int(round(float(value)))}s"


def _milliseconds_text(value: Any) -> str:
    if value is None:
        return "n/a"
    number = float(value)
    if number >= 1000:
        return f"{number / 1000.0:.1f}s"
    return f"{int(round(number))}ms"


def _minutes_text(value: Optional[float]) -> str:
    if value is None:
        return "n/a"
    number = float(value)
    if number >= 120:
        return f"{number / 60.0:.1f}h"
    return f"{int(round(number))}m"


def _compact_message(message: Any) -> str:
    text = re.sub(r"\s+", " ", str(message or "")).strip()
    if len(text) <= 220:
        return text
    return f"{text[:217]}..."


def _log_level_from_message(message: str) -> str:
    lowered = str(message or "").lower()
    if any(token in lowered for token in ("error", "exception", "fatal", "fail")):
        return "ERROR"
    if "warn" in lowered:
        return "WARN"
    return "INFO"


def _join_prefix(root: str, suffix: str) -> str:
    normalized_root = root if root.endswith("/") else f"{root}/"
    normalized = f"{normalized_root}{suffix.lstrip('/')}"
    return normalized if normalized.endswith("/") else f"{normalized}/"
