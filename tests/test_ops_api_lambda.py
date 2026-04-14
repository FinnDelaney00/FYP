"""Unit tests for the operations monitoring API Lambda."""

import base64
import hashlib
import hmac
import json
import sys
import unittest
from datetime import datetime, timedelta, timezone

from tests.helpers import FakeS3Client, load_module


# Default configuration mirrors the deployed resource naming that the Lambda expects.
BASE_ENV = {
    "DATA_LAKE_BUCKET": "ops-monitor-bucket",
    "NAME_PREFIX": "smartstream-dev",
    "OPS_ALARM_NAME_PREFIX": "smartstream-dev",
    "ALLOWED_ORIGIN": "https://monitor.example.com",
    "TRUSTED_ROOT_PREFIX": "trusted/",
    "TRUSTED_ANALYTICS_ROOT_PREFIX": "trusted-analytics/",
    "EMPLOYEE_TRUSTED_PREFIX": "trusted/acme/employees/",
    "FINANCE_TRUSTED_PREFIX": "trusted/acme/finance/transactions/",
    "PREDICTIONS_PREFIX": "trusted-analytics/acme/predictions/",
    "ANOMALIES_PREFIX": "trusted-analytics/acme/anomalies/",
    "KINESIS_STREAM_NAME": "smartstream-dev-cdc-stream",
    "FIREHOSE_DELIVERY_STREAM_NAME": "smartstream-dev-s3-delivery",
    "DMS_PUBLIC_TASK_ID": "public-task",
    "DMS_FINANCE_TASK_ID": "finance-task",
    "TRANSFORM_LAMBDA_NAME": "smartstream-dev-transform",
    "ML_LAMBDA_NAME": "smartstream-dev-ml",
    "ANOMALY_LAMBDA_NAME": "smartstream-dev-anomaly",
    "LIVE_API_LAMBDA_NAME": "smartstream-dev-live-api",
    "TRANSFORM_TIMEOUT_MS": "300000",
    "ML_TIMEOUT_MS": "900000",
    "ANOMALY_TIMEOUT_MS": "900000",
    "LIVE_API_TIMEOUT_MS": "30000",
    "ML_SCHEDULE_EXPRESSION": "rate(1 hour)",
    "ANOMALY_SCHEDULE_EXPRESSION": "rate(2 hours)",
    "OPS_API_REQUIRE_AUTH": "false",
}


class FakeDynamoTable:
    """Very small DynamoDB table fake for auth-related lookups."""

    def __init__(self):
        self.items = {}

    def get_item(self, Key):
        """Return an empty response when the requested item is missing."""

        del Key
        return {}


class FakeDynamoResource:
    """Factory that returns stable fake tables by name."""

    def __init__(self):
        self.tables = {}

    def Table(self, name):
        """Return the fake table instance for the supplied table name."""

        if name not in self.tables:
            self.tables[name] = FakeDynamoTable()
        return self.tables[name]


class FakeCloudWatchClient:
    """CloudWatch fake for metric and alarm lookups used by the ops API."""

    def __init__(self):
        self.metric_points = {}
        self.metric_alarms = []
        self.composite_alarms = []

    def set_metric(self, namespace, metric_name, dimensions, statistic, value, timestamp):
        """Store a single metric datapoint keyed by namespace, name, and dimensions."""

        key = self._metric_key(namespace, metric_name, dimensions)
        self.metric_points[key] = [{"Timestamp": timestamp, statistic: value}]

    def get_metric_statistics(self, Namespace, MetricName, Dimensions, Statistics, **_kwargs):
        """Return datapoints matching the requested statistic."""

        statistic = Statistics[0]
        key = self._metric_key(
            Namespace,
            MetricName,
            {dimension["Name"]: dimension["Value"] for dimension in Dimensions},
        )
        points = []
        for point in self.metric_points.get(key, []):
            if statistic in point:
                points.append(dict(point))
        return {"Datapoints": points}

    def describe_alarms(self, AlarmNamePrefix=None, StateValue=None):
        """Return alarms filtered by prefix and optional state."""

        def matches(alarm):
            if AlarmNamePrefix and not str(alarm.get("AlarmName", "")).startswith(AlarmNamePrefix):
                return False
            if StateValue and str(alarm.get("StateValue", "ALARM")) != StateValue:
                return False
            return True

        return {
            "MetricAlarms": [dict(alarm) for alarm in self.metric_alarms if matches(alarm)],
            "CompositeAlarms": [dict(alarm) for alarm in self.composite_alarms if matches(alarm)],
        }

    @staticmethod
    def _metric_key(namespace, metric_name, dimensions):
        """Normalize dimensions into a stable dictionary-independent key."""

        if isinstance(dimensions, dict):
            items = dimensions.items()
        else:
            items = dimensions
        return (namespace, metric_name, tuple(sorted((str(key), str(value)) for key, value in items)))


class FakeLogsClient:
    """CloudWatch Logs fake that serves recent events by log group."""

    def __init__(self):
        self.events_by_group = {}
        self.fail_groups = set()

    def filter_log_events(self, logGroupName, startTime, limit=50, **_kwargs):
        """Return recent events or raise when a log group is marked unavailable."""

        if logGroupName in self.fail_groups:
            raise RuntimeError(f"Logs unavailable for {logGroupName}")

        events = [
            dict(event)
            for event in self.events_by_group.get(logGroupName, [])
            if int(event.get("timestamp", 0)) >= int(startTime)
        ]
        events.sort(key=lambda event: event.get("timestamp", 0))
        return {"events": events[:limit]}


class FakeDmsClient:
    """DMS fake that returns replication task metadata by task id."""

    def __init__(self):
        self.tasks_by_id = {}

    def describe_replication_tasks(self, Filters):
        """Return the replication task named in the provided filter list."""

        task_id = Filters[0]["Values"][0]
        task = self.tasks_by_id.get(task_id)
        return {"ReplicationTasks": [dict(task)] if task else []}


class OpsApiLambdaTests(unittest.TestCase):
    """Cover overview, pipeline, alarm, log, and auth behaviors of the ops API."""

    module_counter = 0

    def _load_ops_lambda(
        self,
        *,
        fake_s3=None,
        fake_cloudwatch=None,
        fake_logs=None,
        fake_dms=None,
        fake_dynamodb=None,
        env_overrides=None,
    ):
        """Import a fresh copy of the ops Lambda with fake AWS dependencies."""

        type(self).module_counter += 1
        sys.modules.pop("auth_utils", None)
        sys.modules.pop("health_model", None)

        env = dict(BASE_ENV)
        if env_overrides:
            env.update(env_overrides)

        return load_module(
            relative_path="smartstream-terraform/lambdas/ops_api/lambda_function.py",
            module_name=f"ops_api_lambda_under_test_{self.module_counter}",
            fake_s3_client=fake_s3 or FakeS3Client(),
            fake_clients={
                "cloudwatch": fake_cloudwatch or FakeCloudWatchClient(),
                "logs": fake_logs or FakeLogsClient(),
                "dms": fake_dms or FakeDmsClient(),
            },
            fake_resources={"dynamodb": fake_dynamodb or FakeDynamoResource()},
            env=env,
        )

    def _event(self, path, headers=None):
        """Build a GET-only API Gateway event for the requested path."""

        return {
            "requestContext": {"http": {"method": "GET"}},
            "rawPath": path,
            "headers": headers or {},
        }

    def _body(self, response):
        """Decode the JSON body from a Lambda proxy response."""

        self.assertIn("body", response)
        return json.loads(response["body"])

    def _issue_ops_token(self, payload, secret):
        """Create a signed bearer token using the Lambda's lightweight auth format."""

        payload_segment = base64.urlsafe_b64encode(
            json.dumps(payload, separators=(",", ":")).encode("utf-8")
        ).decode("utf-8").rstrip("=")
        signature = hmac.new(
            secret.encode("utf-8"),
            payload_segment.encode("utf-8"),
            hashlib.sha256,
        ).digest()
        signature_segment = base64.urlsafe_b64encode(signature).decode("utf-8").rstrip("=")
        return f"{payload_segment}.{signature_segment}"

    def _add_metric(self, cloudwatch, namespace, metric_name, dimensions, statistic, value, timestamp):
        """Convenience wrapper for storing CloudWatch datapoints in fixtures."""

        cloudwatch.set_metric(namespace, metric_name, dimensions, statistic, value, timestamp)

    def _seed_live_signals(self):
        """Build a realistic mixed-health fixture spanning S3, CloudWatch, Logs, and DMS."""

        now = datetime.now(timezone.utc).replace(microsecond=0)
        fake_s3 = FakeS3Client(
            pages=[
                {
                    "Contents": [
                        {
                            "Key": "trusted/acme/employees/2026/03/13/employees.json",
                            "LastModified": now - timedelta(minutes=4),
                        },
                        {
                            "Key": "trusted/acme/finance/transactions/2026/03/13/transactions.json",
                            "LastModified": now - timedelta(minutes=7),
                        },
                        {
                            "Key": "trusted-analytics/acme/predictions/2026/03/13/predictions.json",
                            "LastModified": now - timedelta(minutes=20),
                        },
                        {
                            "Key": "trusted-analytics/acme/anomalies/2026/03/13/anomalies.json",
                            "LastModified": now - timedelta(minutes=45),
                        },
                    ]
                }
            ]
        )

        fake_cloudwatch = FakeCloudWatchClient()
        fake_logs = FakeLogsClient()
        fake_dms = FakeDmsClient()

        fake_dms.tasks_by_id = {
            "public-task": {"ReplicationTaskIdentifier": "public-task", "Status": "running"},
            "finance-task": {
                "ReplicationTaskIdentifier": "finance-task",
                "Status": "failed",
                "StopReason": "Target apply is 20 minutes behind.",
            },
        }

        self._add_metric(
            fake_cloudwatch,
            "AWS/DMS",
            "CDCLatencySource",
            {"ReplicationTaskIdentifier": "public-task"},
            "Maximum",
            12,
            now - timedelta(minutes=2),
        )
        self._add_metric(
            fake_cloudwatch,
            "AWS/DMS",
            "CDCLatencyTarget",
            {"ReplicationTaskIdentifier": "public-task"},
            "Maximum",
            16,
            now - timedelta(minutes=2),
        )
        self._add_metric(
            fake_cloudwatch,
            "AWS/DMS",
            "CDCLatencySource",
            {"ReplicationTaskIdentifier": "finance-task"},
            "Maximum",
            220,
            now - timedelta(minutes=2),
        )
        self._add_metric(
            fake_cloudwatch,
            "AWS/DMS",
            "CDCLatencyTarget",
            {"ReplicationTaskIdentifier": "finance-task"},
            "Maximum",
            1200,
            now - timedelta(minutes=2),
        )

        self._add_metric(
            fake_cloudwatch,
            "AWS/Kinesis",
            "GetRecords.IteratorAgeMilliseconds",
            {"StreamName": "smartstream-dev-cdc-stream"},
            "Maximum",
            5000,
            now - timedelta(minutes=1),
        )
        self._add_metric(
            fake_cloudwatch,
            "AWS/Kinesis",
            "WriteProvisionedThroughputExceeded",
            {"StreamName": "smartstream-dev-cdc-stream"},
            "Sum",
            0,
            now - timedelta(minutes=1),
        )
        self._add_metric(
            fake_cloudwatch,
            "AWS/Kinesis",
            "IncomingRecords",
            {"StreamName": "smartstream-dev-cdc-stream"},
            "Sum",
            400,
            now - timedelta(minutes=1),
        )

        self._add_metric(
            fake_cloudwatch,
            "AWS/Firehose",
            "DeliveryToS3.DataFreshness",
            {"DeliveryStreamName": "smartstream-dev-s3-delivery"},
            "Maximum",
            180,
            now - timedelta(minutes=1),
        )
        self._add_metric(
            fake_cloudwatch,
            "AWS/Firehose",
            "DeliveryToS3.Success",
            {"DeliveryStreamName": "smartstream-dev-s3-delivery"},
            "Sum",
            6,
            now - timedelta(minutes=1),
        )

        self._add_metric(
            fake_cloudwatch,
            "AWS/Lambda",
            "Invocations",
            {"FunctionName": "smartstream-dev-transform"},
            "Sum",
            36,
            now - timedelta(minutes=3),
        )
        self._add_metric(
            fake_cloudwatch,
            "AWS/Lambda",
            "Errors",
            {"FunctionName": "smartstream-dev-transform"},
            "Sum",
            0,
            now - timedelta(minutes=3),
        )
        self._add_metric(
            fake_cloudwatch,
            "AWS/Lambda",
            "Duration",
            {"FunctionName": "smartstream-dev-transform"},
            "Average",
            110000,
            now - timedelta(minutes=3),
        )
        self._add_metric(
            fake_cloudwatch,
            "AWS/Lambda",
            "Throttles",
            {"FunctionName": "smartstream-dev-transform"},
            "Sum",
            0,
            now - timedelta(minutes=3),
        )

        self._add_metric(
            fake_cloudwatch,
            "AWS/Lambda",
            "Invocations",
            {"FunctionName": "smartstream-dev-ml"},
            "Sum",
            10,
            now - timedelta(minutes=15),
        )
        self._add_metric(
            fake_cloudwatch,
            "AWS/Lambda",
            "Errors",
            {"FunctionName": "smartstream-dev-ml"},
            "Sum",
            5,
            now - timedelta(minutes=15),
        )
        self._add_metric(
            fake_cloudwatch,
            "AWS/Lambda",
            "Duration",
            {"FunctionName": "smartstream-dev-ml"},
            "Average",
            250000,
            now - timedelta(minutes=15),
        )
        self._add_metric(
            fake_cloudwatch,
            "AWS/Lambda",
            "Throttles",
            {"FunctionName": "smartstream-dev-ml"},
            "Sum",
            0,
            now - timedelta(minutes=15),
        )

        self._add_metric(
            fake_cloudwatch,
            "AWS/Lambda",
            "Invocations",
            {"FunctionName": "smartstream-dev-anomaly"},
            "Sum",
            8,
            now - timedelta(minutes=25),
        )
        self._add_metric(
            fake_cloudwatch,
            "AWS/Lambda",
            "Errors",
            {"FunctionName": "smartstream-dev-anomaly"},
            "Sum",
            0,
            now - timedelta(minutes=25),
        )
        self._add_metric(
            fake_cloudwatch,
            "AWS/Lambda",
            "Duration",
            {"FunctionName": "smartstream-dev-anomaly"},
            "Average",
            140000,
            now - timedelta(minutes=25),
        )
        self._add_metric(
            fake_cloudwatch,
            "AWS/Lambda",
            "Throttles",
            {"FunctionName": "smartstream-dev-anomaly"},
            "Sum",
            0,
            now - timedelta(minutes=25),
        )

        self._add_metric(
            fake_cloudwatch,
            "AWS/Lambda",
            "Invocations",
            {"FunctionName": "smartstream-dev-live-api"},
            "Sum",
            120,
            now - timedelta(minutes=5),
        )
        self._add_metric(
            fake_cloudwatch,
            "AWS/Lambda",
            "Errors",
            {"FunctionName": "smartstream-dev-live-api"},
            "Sum",
            0,
            now - timedelta(minutes=5),
        )
        self._add_metric(
            fake_cloudwatch,
            "AWS/Lambda",
            "Duration",
            {"FunctionName": "smartstream-dev-live-api"},
            "Average",
            2400,
            now - timedelta(minutes=5),
        )
        self._add_metric(
            fake_cloudwatch,
            "AWS/Lambda",
            "Throttles",
            {"FunctionName": "smartstream-dev-live-api"},
            "Sum",
            0,
            now - timedelta(minutes=5),
        )

        fake_cloudwatch.metric_alarms = [
            {
                "AlarmName": "smartstream-dev-finance-cdc-latency-target",
                "AlarmDescription": "Finance CDC target latency is above threshold.",
                "StateUpdatedTimestamp": now - timedelta(minutes=4),
                "StateValue": "ALARM",
            },
            {
                "AlarmName": "smartstream-dev-forecast-ml-errors",
                "StateReason": "Forecast ML Lambda errors are elevated.",
                "StateUpdatedTimestamp": now - timedelta(minutes=9),
                "StateValue": "ALARM",
            },
        ]

        fake_logs.events_by_group = {
            "/aws/dms/tasks/finance-task": [
                {
                    "timestamp": self._millis(now - timedelta(minutes=6)),
                    "message": "ERROR finance CDC target latency exceeded threshold and apply queue is backing up",
                }
            ],
            "/aws/lambda/smartstream-dev-ml": [
                {
                    "timestamp": self._millis(now - timedelta(minutes=5)),
                    "message": "ERROR forecast batch failed for 2 partitions during the latest run",
                }
            ],
            "/aws/kinesisfirehose/smartstream-dev-s3-delivery": [
                {
                    "timestamp": self._millis(now - timedelta(minutes=10)),
                    "message": "WARN delivery retries increased for the S3 destination",
                }
            ],
        }

        return {
            "fake_s3": fake_s3,
            "fake_cloudwatch": fake_cloudwatch,
            "fake_logs": fake_logs,
            "fake_dms": fake_dms,
        }

    def _seed_empty_signals(self):
        """Build a fixture where AWS services are reachable but have no recent signal data."""

        fake_s3 = FakeS3Client(pages=[{"Contents": []}])
        fake_cloudwatch = FakeCloudWatchClient()
        fake_logs = FakeLogsClient()
        fake_dms = FakeDmsClient()
        fake_dms.tasks_by_id = {
            "public-task": {"ReplicationTaskIdentifier": "public-task", "Status": "running"},
            "finance-task": {"ReplicationTaskIdentifier": "finance-task", "Status": "running"},
        }

        return {
            "fake_s3": fake_s3,
            "fake_cloudwatch": fake_cloudwatch,
            "fake_logs": fake_logs,
            "fake_dms": fake_dms,
        }

    def _load_live_module(self):
        """Load the ops Lambda using the mixed-health live-signal fixture."""

        fixture = self._seed_live_signals()
        return self._load_ops_lambda(**fixture)

    @staticmethod
    def _millis(value):
        """Convert a timezone-aware datetime into epoch milliseconds."""

        return int(value.timestamp() * 1000)

    def test_overview_returns_normalized_summary(self):
        """The overview route should summarize pipeline health into a dashboard-friendly payload."""

        module = self._load_live_module()

        response = module.lambda_handler(self._event("/ops/overview"), _context=None)
        payload = self._body(response)

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(payload["data"]["total_pipelines"], 4)
        self.assertEqual(payload["data"]["healthy"], 2)
        self.assertEqual(payload["data"]["degraded"], 1)
        self.assertEqual(payload["data"]["down"], 1)
        self.assertEqual(payload["data"]["active_alarms"], 2)
        self.assertIn("last_updated", payload["data"])
        self.assertEqual(payload["meta"]["source"], "live")
        self.assertFalse(payload["meta"]["partial_data"])

    def test_pipelines_returns_pipeline_rows(self):
        """The pipelines route should return one normalized row per monitored pipeline."""

        module = self._load_live_module()

        response = module.lambda_handler(self._event("/ops/pipelines"), _context=None)
        payload = self._body(response)
        rows = payload["data"]
        rows_by_id = {row["id"]: row for row in rows}

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(len(rows), 4)
        self.assertEqual(rows_by_id["employee-pipeline"]["overall_status"], "healthy")
        self.assertEqual(rows_by_id["finance-pipeline"]["overall_status"], "down")
        self.assertEqual(rows_by_id["forecast-pipeline"]["overall_status"], "degraded")
        self.assertGreaterEqual(rows_by_id["finance-pipeline"]["alarm_count"], 1)
        self.assertIn("status_history", rows_by_id["employee-pipeline"])
        self.assertIn("recent_error_summary", rows_by_id["forecast-pipeline"])

    def test_pipeline_detail_returns_component_health(self):
        """Pipeline detail should expand a pipeline into component-level health information."""

        module = self._load_live_module()

        response = module.lambda_handler(self._event("/ops/pipelines/finance-pipeline"), _context=None)
        payload = self._body(response)
        detail = payload["data"]

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(detail["id"], "finance-pipeline")
        self.assertEqual(detail["overall_status"], "down")
        self.assertGreaterEqual(len(detail["components"]), 5)
        self.assertGreaterEqual(len(detail["active_alarms"]), 1)
        self.assertGreaterEqual(len(detail["recent_errors"]), 1)
        self.assertIn("dms:finance-task", detail["impacted_resources"])
        self.assertIsNotNone(detail["last_failure_at"])

    def test_alarms_returns_normalized_alarm_list(self):
        """Alarm listing should normalize active CloudWatch alarms for the UI."""

        module = self._load_live_module()

        response = module.lambda_handler(self._event("/ops/alarms"), _context=None)
        payload = self._body(response)
        alarms = payload["data"]
        alarms_by_pipeline = {alarm["pipeline_id"]: alarm for alarm in alarms}

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(len(alarms), 2)
        self.assertEqual(alarms_by_pipeline["finance-pipeline"]["pipeline_name"], "Finance pipeline")
        self.assertEqual(alarms_by_pipeline["finance-pipeline"]["state"], "ALARM")
        self.assertIn("severity", alarms_by_pipeline["forecast-pipeline"])
        self.assertIn("resource", alarms_by_pipeline["forecast-pipeline"])

    def test_log_summary_returns_normalized_service_rows(self):
        """Log summary should collapse recent CloudWatch log events into service rows."""

        module = self._load_live_module()

        response = module.lambda_handler(self._event("/ops/log-summary"), _context=None)
        payload = self._body(response)
        rows = payload["data"]

        self.assertEqual(response["statusCode"], 200)
        self.assertTrue(any(row["service"] == "forecast-ml-lambda" for row in rows))
        self.assertTrue(any(row["service"] == "firehose" for row in rows))
        forecast_row = next(row for row in rows if row["service"] == "forecast-ml-lambda")
        self.assertEqual(forecast_row["level"], "ERROR")
        self.assertGreaterEqual(forecast_row["count_15m"], 1)

    def test_empty_aws_signals_return_normalized_payloads(self):
        """Routes should still return normalized shapes when no AWS signals are present."""

        module = self._load_ops_lambda(**self._seed_empty_signals())

        overview_response = module.lambda_handler(self._event("/ops/overview"), _context=None)
        overview_payload = self._body(overview_response)
        pipelines_response = module.lambda_handler(self._event("/ops/pipelines"), _context=None)
        pipelines_payload = self._body(pipelines_response)
        alarms_response = module.lambda_handler(self._event("/ops/alarms"), _context=None)
        alarms_payload = self._body(alarms_response)

        self.assertEqual(overview_response["statusCode"], 200)
        self.assertEqual(overview_payload["data"]["total_pipelines"], 4)
        self.assertEqual(overview_payload["data"]["active_alarms"], 0)
        self.assertFalse(overview_payload["meta"]["partial_data"])
        self.assertEqual(len(pipelines_payload["data"]), 4)
        self.assertEqual(alarms_payload["data"], [])
        self.assertTrue(all("overall_status" in row for row in pipelines_payload["data"]))

    def test_partial_data_is_flagged_when_cloudwatch_logs_unavailable(self):
        """Unavailable log groups should set the partial-data flag and add a warning."""

        fixture = self._seed_live_signals()
        fixture["fake_logs"].fail_groups.add("/aws/lambda/smartstream-dev-ml")
        module = self._load_ops_lambda(**fixture)

        response = module.lambda_handler(self._event("/ops/overview"), _context=None)
        payload = self._body(response)

        self.assertEqual(response["statusCode"], 200)
        self.assertTrue(payload["meta"]["partial_data"])
        self.assertTrue(any("CloudWatch Logs unavailable" in warning for warning in payload["meta"]["warnings"]))

    def test_status_derivation_covers_healthy_degraded_and_down(self):
        """Mixed fixtures should exercise every major derived pipeline status bucket."""

        module = self._load_live_module()

        response = module.lambda_handler(self._event("/ops/pipelines"), _context=None)
        payload = self._body(response)
        statuses = {row["id"]: row["overall_status"] for row in payload["data"]}

        self.assertEqual(statuses["employee-pipeline"], "healthy")
        self.assertEqual(statuses["forecast-pipeline"], "degraded")
        self.assertEqual(statuses["finance-pipeline"], "down")

    def test_auth_required_rejects_missing_token(self):
        """When auth is enabled, unauthenticated requests should return 401."""

        module = self._load_ops_lambda(env_overrides={"OPS_API_REQUIRE_AUTH": "true"})

        response = module.lambda_handler(self._event("/ops/overview"), _context=None)
        body = self._body(response)

        self.assertEqual(response["statusCode"], 401)
        self.assertIn("Authorization", body["message"])

    def test_auth_required_rejects_insufficient_role(self):
        """Authenticated users below the required role should be rejected."""

        fake_dynamodb = FakeDynamoResource()
        fake_dynamodb.Table("accounts").items["viewer@example.com"] = {
            "email": "viewer@example.com",
            "company_id": "acme",
            "role": "viewer",
            "status": "active",
        }
        fake_dynamodb.Table("companies").items["acme"] = {
            "company_id": "acme",
            "status": "active",
        }
        module = self._load_ops_lambda(
            fake_dynamodb=fake_dynamodb,
            env_overrides={
                "OPS_API_REQUIRE_AUTH": "true",
                "AUTH_TOKEN_SECRET": "ops-secret",
                "ACCOUNTS_TABLE": "accounts",
                "COMPANIES_TABLE": "companies",
            },
        )
        token = self._issue_ops_token(
            {
                "sub": "viewer@example.com",
                "company_id": "acme",
                "role": "viewer",
                "exp": 2524608000,
            },
            "ops-secret",
        )
        headers = {"authorization": f"Bearer {token}"}

        response = module.lambda_handler(self._event("/ops/overview", headers=headers), _context=None)

        self.assertEqual(response["statusCode"], 403)

    def test_authenticated_requests_include_identity_in_meta(self):
        """Authenticated responses should include the resolved identity in the metadata block."""

        fake_dynamodb = FakeDynamoResource()
        fake_dynamodb.Table("accounts").items["admin@example.com"] = {
            "email": "admin@example.com",
            "company_id": "acme",
            "role": "admin",
            "status": "active",
        }
        fake_dynamodb.Table("companies").items["acme"] = {
            "company_id": "acme",
            "status": "active",
        }
        fixture = self._seed_live_signals()
        module = self._load_ops_lambda(
            fake_s3=fixture["fake_s3"],
            fake_cloudwatch=fixture["fake_cloudwatch"],
            fake_logs=fixture["fake_logs"],
            fake_dms=fixture["fake_dms"],
            fake_dynamodb=fake_dynamodb,
            env_overrides={
                "OPS_API_REQUIRE_AUTH": "true",
                "AUTH_TOKEN_SECRET": "ops-secret",
                "ACCOUNTS_TABLE": "accounts",
                "COMPANIES_TABLE": "companies",
            },
        )
        token = self._issue_ops_token(
            {
                "sub": "admin@example.com",
                "company_id": "acme",
                "role": "admin",
                "exp": 2524608000,
            },
            "ops-secret",
        )
        headers = {"authorization": f"Bearer {token}"}

        response = module.lambda_handler(self._event("/ops/overview", headers=headers), _context=None)
        body = self._body(response)

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(body["meta"]["authenticated_as"], "admin@example.com")
        self.assertEqual(body["meta"]["role"], "admin")

    def test_non_get_method_is_rejected(self):
        """The ops API should reject non-GET methods across the monitored routes."""

        module = self._load_live_module()
        event = {
            "requestContext": {"http": {"method": "POST"}},
            "rawPath": "/ops/overview",
        }

        response = module.lambda_handler(event, _context=None)

        self.assertEqual(response["statusCode"], 405)


if __name__ == "__main__":
    unittest.main()
