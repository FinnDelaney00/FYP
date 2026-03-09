import json
import unittest
from datetime import datetime, timezone

from tests.helpers import FakeS3Client, gzip_bytes, load_module


class _FakeAthenaResultsPaginator:
    def __init__(self, athena_client):
        self._athena_client = athena_client

    def paginate(self, QueryExecutionId):
        result = self._athena_client.query_results.get(QueryExecutionId) or {
            "columns": [],
            "rows": [],
        }
        columns = result["columns"]
        rows = result["rows"]
        yield {
            "ResultSet": {
                "ResultSetMetadata": {
                    "ColumnInfo": [{"Name": name} for name in columns],
                },
                "Rows": [
                    {"Data": [{"VarCharValue": column} for column in columns]},
                    *[
                        {"Data": [{"VarCharValue": str(row.get(column, ""))} for column in columns]}
                        for row in rows
                    ],
                ],
            }
        }


class FakeAthenaClient:
    def __init__(self):
        self.started_queries = []
        self.query_results = {}
        self.fail_reason = None
        self.stopped_queries = []
        self.counter = 0

    def start_query_execution(self, QueryString, QueryExecutionContext, WorkGroup):
        self.counter += 1
        query_id = f"q-{self.counter}"
        self.started_queries.append(
            {
                "id": query_id,
                "query": QueryString,
                "database": QueryExecutionContext.get("Database"),
                "workgroup": WorkGroup,
            }
        )
        return {"QueryExecutionId": query_id}

    def get_query_execution(self, QueryExecutionId):
        if self.fail_reason:
            state = "FAILED"
        else:
            state = "SUCCEEDED"
        status = {"State": state}
        if self.fail_reason:
            status["StateChangeReason"] = self.fail_reason
        return {"QueryExecution": {"Status": status}}

    def stop_query_execution(self, QueryExecutionId):
        self.stopped_queries.append(QueryExecutionId)

    def get_paginator(self, name):
        if name != "get_query_results":
            raise ValueError(f"Unsupported paginator: {name}")
        return _FakeAthenaResultsPaginator(self)


class FakeDynamoTable:
    def __init__(self):
        self.items = {}

    def get_item(self, Key):
        email = Key.get("email")
        if email in self.items:
            return {"Item": dict(self.items[email])}
        return {}

    def put_item(self, Item, ConditionExpression=None):
        email = Item.get("email")
        if ConditionExpression == "attribute_not_exists(email)" and email in self.items:
            raise Exception("ConditionalCheckFailedException")
        self.items[email] = dict(Item)
        return {"ResponseMetadata": {"HTTPStatusCode": 200}}


class FakeDynamoResource:
    def __init__(self):
        self.tables = {}

    def Table(self, name):
        if name not in self.tables:
            self.tables[name] = FakeDynamoTable()
        return self.tables[name]


class LiveApiLambdaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake_s3 = FakeS3Client()
        cls.fake_athena = FakeAthenaClient()
        cls.fake_dynamodb = FakeDynamoResource()
        cls.module = load_module(
            relative_path="smartstream-terraform/lambdas/live_api/lambda_function.py",
            module_name="live_api_lambda_under_test",
            fake_s3_client=cls.fake_s3,
            fake_clients={"athena": cls.fake_athena},
            fake_resources={"dynamodb": cls.fake_dynamodb},
            env={
                "DATA_LAKE_BUCKET": "test-data-lake",
                "TRUSTED_PREFIX": "trusted/finance/transactions/",
                "EMPLOYEES_PREFIX": "trusted/employees/",
                "PREDICTIONS_PREFIX": "trusted-analytics/predictions/",
                "ANOMALIES_PREFIX": "trusted-analytics/anomalies/",
                "MAX_ITEMS_DEFAULT": "200",
                "QUERY_MAX_ROWS": "100",
                "ALLOWED_ORIGIN": "https://example.com",
                "ATHENA_WORKGROUP": "wg-test",
                "ATHENA_DATABASE": "db_test",
                "ACCOUNTS_TABLE": "accounts",
                "ANOMALY_REVIEWS_TABLE": "anomaly_reviews",
                "AUTH_TOKEN_SECRET": "unit-test-secret",
                "AUTH_TOKEN_TTL_SECONDS": "3600",
            },
        )

    def setUp(self):
        self.fake_s3.objects.clear()
        self.fake_s3.pages = []
        self.fake_s3.put_calls.clear()
        self.fake_athena.started_queries.clear()
        self.fake_athena.query_results.clear()
        self.fake_athena.fail_reason = None
        self.fake_athena.stopped_queries.clear()
        self.fake_dynamodb.tables["accounts"] = FakeDynamoTable()
        self.fake_dynamodb.tables["anomaly_reviews"] = FakeDynamoTable()

    def _auth_headers(self, email="test@example.com", display_name="Test User"):
        token = self.module._issue_token(email, display_name)
        return {"authorization": f"Bearer {token}"}

    def test_parse_limit_defaults_and_clamps(self):
        no_limit = self.module._parse_limit({"queryStringParameters": None})
        invalid = self.module._parse_limit({"queryStringParameters": {"limit": "abc"}})
        too_high = self.module._parse_limit({"queryStringParameters": {"limit": "9999"}})
        too_low = self.module._parse_limit({"queryStringParameters": {"limit": "0"}})
        normal = self.module._parse_limit({"queryStringParameters": {"limit": "25"}})
        self.assertEqual(no_limit, 200)
        self.assertEqual(invalid, 200)
        self.assertEqual(too_high, 200)
        self.assertEqual(too_low, 1)
        self.assertEqual(normal, 25)

    def test_options_returns_cors_headers(self):
        response = self.module.lambda_handler(
            {"requestContext": {"http": {"method": "OPTIONS"}}, "rawPath": "/latest"},
            _context=None,
        )
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(response["headers"]["Access-Control-Allow-Origin"], "https://example.com")

    def test_signup_creates_user_and_returns_token(self):
        response = self.module.lambda_handler(
            {
                "requestContext": {"http": {"method": "POST"}},
                "rawPath": "/auth/signup",
                "body": json.dumps(
                    {"email": "new@example.com", "password": "Password123", "display_name": "New User"}
                ),
            },
            _context=None,
        )
        body = json.loads(response["body"])
        self.assertEqual(response["statusCode"], 201)
        self.assertIn("token", body)
        self.assertEqual(body["user"]["email"], "new@example.com")

    def test_signup_rejects_duplicate_email(self):
        event = {
            "requestContext": {"http": {"method": "POST"}},
            "rawPath": "/auth/signup",
            "body": json.dumps({"email": "dup@example.com", "password": "Password123"}),
        }
        first = self.module.lambda_handler(event, _context=None)
        second = self.module.lambda_handler(event, _context=None)
        self.assertEqual(first["statusCode"], 201)
        self.assertEqual(second["statusCode"], 409)

    def test_login_success_and_failure(self):
        self.module.lambda_handler(
            {
                "requestContext": {"http": {"method": "POST"}},
                "rawPath": "/auth/signup",
                "body": json.dumps({"email": "login@example.com", "password": "Password123"}),
            },
            _context=None,
        )

        success = self.module.lambda_handler(
            {
                "requestContext": {"http": {"method": "POST"}},
                "rawPath": "/auth/login",
                "body": json.dumps({"email": "login@example.com", "password": "Password123"}),
            },
            _context=None,
        )
        failed = self.module.lambda_handler(
            {
                "requestContext": {"http": {"method": "POST"}},
                "rawPath": "/auth/login",
                "body": json.dumps({"email": "login@example.com", "password": "wrong"}),
            },
            _context=None,
        )
        self.assertEqual(success["statusCode"], 200)
        self.assertEqual(failed["statusCode"], 401)

    def test_auth_me_requires_valid_token(self):
        self.module.lambda_handler(
            {
                "requestContext": {"http": {"method": "POST"}},
                "rawPath": "/auth/signup",
                "body": json.dumps({"email": "me@example.com", "password": "Password123"}),
            },
            _context=None,
        )

        unauthorized = self.module.lambda_handler(
            {"requestContext": {"http": {"method": "GET"}}, "rawPath": "/auth/me"},
            _context=None,
        )
        authorized = self.module.lambda_handler(
            {
                "requestContext": {"http": {"method": "GET"}},
                "rawPath": "/auth/me",
                "headers": self._auth_headers(email="me@example.com"),
            },
            _context=None,
        )
        self.assertEqual(unauthorized["statusCode"], 401)
        self.assertEqual(authorized["statusCode"], 200)

    def test_get_latest_requires_auth(self):
        self.fake_s3.pages = [{"Contents": []}]
        response = self.module.lambda_handler(
            {"requestContext": {"http": {"method": "GET"}}, "rawPath": "/latest"},
            _context=None,
        )
        self.assertEqual(response["statusCode"], 401)

    def test_get_latest_returns_latest_items(self):
        older_key = "trusted/finance/transactions/2026/02/23/old.json"
        newest_key = "trusted/finance/transactions/2026/02/24/new.json.gz"
        self.fake_s3.pages = [
            {
                "Contents": [
                    {"Key": older_key, "LastModified": datetime(2026, 2, 23, 12, 0, tzinfo=timezone.utc)},
                    {"Key": newest_key, "LastModified": datetime(2026, 2, 24, 12, 0, tzinfo=timezone.utc)},
                ]
            }
        ]
        self.fake_s3.objects = {
            older_key: '[{"id":"old"}]',
            newest_key: gzip_bytes('\n'.join([json.dumps({"id": "a"}), json.dumps({"id": "b"})])),
        }

        response = self.module.lambda_handler(
            {
                "requestContext": {"http": {"method": "GET"}},
                "rawPath": "/latest",
                "queryStringParameters": {"limit": "1"},
                "headers": self._auth_headers(),
            },
            _context=None,
        )
        body = json.loads(response["body"])
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(body["s3_key"], newest_key)
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["items"][0]["id"], "b")

    def test_dashboard_uses_prediction_and_s3_sources(self):
        prediction_key = "trusted-analytics/predictions/2026/02/24/predictions.json"
        employee_key = "trusted/employees/employees/2026/02/24/employee.json"
        finance_key = "trusted/finance/transactions/2026/02/24/finance.json"

        self.fake_s3.pages = [
            {
                "Contents": [
                    {"Key": prediction_key, "LastModified": datetime(2026, 2, 24, 10, 0, tzinfo=timezone.utc)},
                    {"Key": employee_key, "LastModified": datetime(2026, 2, 24, 9, 0, tzinfo=timezone.utc)},
                    {"Key": finance_key, "LastModified": datetime(2026, 2, 24, 8, 0, tzinfo=timezone.utc)},
                ]
            }
        ]
        self.fake_s3.objects = {
            prediction_key: json.dumps(
                {
                    "status": "ok",
                    "generated_at": "2026-02-24T10:00:00Z",
                    "diagnostics": {"rows_processed": {"employees": 12, "finance": 8}},
                    "insights": {
                        "employee_growth": {
                            "history": [{"date": "2026-02-23", "headcount": 9}],
                            "forecast": [{"date": "2026-02-24", "predicted_headcount": 10}],
                        },
                        "finance": {
                            "revenue": {"history": [{"date": "2026-02-23", "revenue": 140.0}], "forecast": []},
                            "expenditure": {"history": [{"date": "2026-02-23", "expenditure": 60.0}], "forecast": []},
                        },
                    },
                }
            ),
            employee_key: '\n'.join(
                [
                    json.dumps({"id": "1", "department": "Engineering"}),
                    json.dumps({"id": "2", "department": "Sales"}),
                ]
            ),
            finance_key: json.dumps({"transaction_date": "2026-02-23", "amount": 140, "type": "sale"}),
        }

        response = self.module.lambda_handler(
            {"requestContext": {"http": {"method": "GET"}}, "rawPath": "/dashboard", "headers": self._auth_headers()},
            _context=None,
        )
        body = json.loads(response["body"])
        self.assertEqual(response["statusCode"], 200)
        self.assertIn("metrics", body)
        self.assertIn("charts", body)
        self.assertEqual(body["sources"]["latest_prediction_key"], prediction_key)

    def test_query_route_executes_select_and_returns_rows(self):
        self.fake_athena.query_results["q-1"] = {
            "columns": ["department", "count"],
            "rows": [{"department": "Engineering", "count": "10"}],
        }

        response = self.module.lambda_handler(
            {
                "requestContext": {"http": {"method": "POST"}},
                "rawPath": "/query",
                "headers": self._auth_headers(),
                "body": json.dumps({"query": "SELECT department, count(*) AS count FROM employees", "limit": 50}),
            },
            _context=None,
        )
        body = json.loads(response["body"])
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(body["row_count"], 1)
        self.assertEqual(body["columns"], ["department", "count"])
        self.assertIn("LIMIT", self.fake_athena.started_queries[0]["query"].upper())

    def test_anomalies_route_returns_items_and_summary(self):
        anomaly_key = "trusted-analytics/anomalies/2026/03/09/anomalies.json"
        self.fake_s3.pages = [
            {
                "Contents": [
                    {"Key": anomaly_key, "LastModified": datetime(2026, 3, 9, 10, 0, tzinfo=timezone.utc)},
                ]
            }
        ]
        self.fake_s3.objects = {
            anomaly_key: json.dumps(
                {
                    "generated_at": "2026-03-09T10:00:00Z",
                    "anomalies": [
                        {
                            "anomaly_id": "a-1",
                            "entity_type": "transaction",
                            "record_ids": ["t-1"],
                            "anomaly_type": "large_transaction",
                            "severity": "high",
                            "confidence": 0.94,
                            "title": "Large transaction",
                            "description": "Amount exceeds baseline.",
                            "reasons": ["Large deviation from baseline"],
                            "status": "new",
                            "suggested_action": "review",
                            "metrics": {"actual_value": 1500, "expected_value": 200},
                            "detected_at": "2026-03-09T09:59:00Z",
                            "source_table": "transactions",
                            "audit_trail": [],
                        }
                    ],
                }
            )
        }

        response = self.module.lambda_handler(
            {"requestContext": {"http": {"method": "GET"}}, "rawPath": "/anomalies", "headers": self._auth_headers()},
            _context=None,
        )
        body = json.loads(response["body"])

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["summary"]["high_priority_count"], 1)

    def test_anomaly_action_updates_review_state(self):
        anomaly_key = "trusted-analytics/anomalies/2026/03/09/anomalies.json"
        self.fake_s3.pages = [
            {
                "Contents": [
                    {"Key": anomaly_key, "LastModified": datetime(2026, 3, 9, 10, 0, tzinfo=timezone.utc)},
                ]
            }
        ]
        self.fake_s3.objects = {
            anomaly_key: json.dumps(
                {
                    "generated_at": "2026-03-09T10:00:00Z",
                    "anomalies": [
                        {
                            "anomaly_id": "a-2",
                            "entity_type": "employee",
                            "record_ids": ["e-7"],
                            "anomaly_type": "salary_outlier",
                            "severity": "medium",
                            "confidence": 0.82,
                            "title": "Salary outlier",
                            "description": "Salary is outside expected range.",
                            "reasons": ["z-score exceeded threshold"],
                            "status": "new",
                            "suggested_action": "review",
                            "metrics": {"actual_value": 180000, "expected_value": 90000},
                            "detected_at": "2026-03-09T09:59:00Z",
                            "source_table": "employees",
                            "audit_trail": [],
                        }
                    ],
                }
            )
        }

        action_response = self.module.lambda_handler(
            {
                "requestContext": {"http": {"method": "POST"}},
                "rawPath": "/anomalies/a-2/actions",
                "headers": self._auth_headers(email="reviewer@example.com", display_name="Reviewer"),
                "body": json.dumps({"action": "mark_confirmed", "note": "Checked with HR."}),
            },
            _context=None,
        )
        action_body = json.loads(action_response["body"])

        self.assertEqual(action_response["statusCode"], 200)
        self.assertEqual(action_body["item"]["status"], "confirmed")
        self.assertGreaterEqual(len(action_body["item"]["audit_trail"]), 1)

        detail_response = self.module.lambda_handler(
            {"requestContext": {"http": {"method": "GET"}}, "rawPath": "/anomalies/a-2", "headers": self._auth_headers()},
            _context=None,
        )
        detail_body = json.loads(detail_response["body"])

        self.assertEqual(detail_response["statusCode"], 200)
        self.assertEqual(detail_body["item"]["status"], "confirmed")

    def test_query_route_rejects_non_read_only_sql(self):
        response = self.module.lambda_handler(
            {
                "requestContext": {"http": {"method": "POST"}},
                "rawPath": "/query",
                "headers": self._auth_headers(),
                "body": json.dumps({"query": "DELETE FROM employees"}),
            },
            _context=None,
        )
        body = json.loads(response["body"])
        self.assertEqual(response["statusCode"], 400)
        self.assertIn("read-only", body["message"])


if __name__ == "__main__":
    unittest.main()
