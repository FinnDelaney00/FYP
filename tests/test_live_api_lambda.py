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


class LiveApiLambdaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake_s3 = FakeS3Client()
        cls.fake_athena = FakeAthenaClient()
        cls.module = load_module(
            relative_path="smartstream-terraform/lambdas/live_api/lambda_function.py",
            module_name="live_api_lambda_under_test",
            fake_s3_client=cls.fake_s3,
            fake_clients={"athena": cls.fake_athena},
            env={
                "DATA_LAKE_BUCKET": "test-data-lake",
                "TRUSTED_PREFIX": "trusted/finance/transactions/",
                "EMPLOYEES_PREFIX": "trusted/employees/",
                "PREDICTIONS_PREFIX": "trusted-analytics/predictions/",
                "MAX_ITEMS_DEFAULT": "200",
                "QUERY_MAX_ROWS": "100",
                "ALLOWED_ORIGIN": "https://example.com",
                "ATHENA_WORKGROUP": "wg-test",
                "ATHENA_DATABASE": "db_test",
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

    def test_decode_object_bytes_handles_plain_and_gzip(self):
        plain = self.module._decode_object_bytes("sample.json", b'{"a":1}')
        gzipped = self.module._decode_object_bytes("sample.json.gz", gzip_bytes('{"a":2}'))
        self.assertEqual(plain, '{"a":1}')
        self.assertEqual(gzipped, '{"a":2}')

    def test_parse_items_supports_array_json_lines_and_empty(self):
        parsed_array = self.module._parse_items('[{"id":1},{"id":2}]')
        parsed_lines = self.module._parse_items('{"id":1}\n{"id":2}\n')
        parsed_empty = self.module._parse_items("   ")
        self.assertEqual(len(parsed_array), 2)
        self.assertEqual(len(parsed_lines), 2)
        self.assertEqual(parsed_empty, [])

    def test_options_returns_cors_headers(self):
        response = self.module.lambda_handler(
            {"requestContext": {"http": {"method": "OPTIONS"}}, "rawPath": "/latest"},
            _context=None,
        )
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(response["headers"]["Access-Control-Allow-Origin"], "https://example.com")

    def test_get_latest_returns_empty_when_no_objects(self):
        self.fake_s3.pages = [{"Contents": []}]
        response = self.module.lambda_handler(
            {"requestContext": {"http": {"method": "GET"}}, "rawPath": "/latest"},
            _context=None,
        )
        body = json.loads(response["body"])
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(body["items"], [])
        self.assertIsNone(body["s3_key"])
        self.assertIsNone(body["last_modified"])

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
                            "forecast": [
                                {"date": "2026-02-24", "predicted_headcount": 10},
                                {"date": "2026-02-25", "predicted_headcount": 11},
                            ],
                        },
                        "finance": {
                            "revenue": {
                                "history": [{"date": "2026-02-23", "revenue": 140.0}],
                                "forecast": [{"date": "2026-02-24", "predicted_revenue": 144.0}],
                            },
                            "expenditure": {
                                "history": [{"date": "2026-02-23", "expenditure": 60.0}],
                                "forecast": [{"date": "2026-02-24", "predicted_expenditure": 63.0}],
                            },
                        },
                    },
                }
            ),
            employee_key: '\n'.join(
                [
                    json.dumps({"id": "1", "department": "Engineering"}),
                    json.dumps({"id": "2", "department": "Sales"}),
                    json.dumps({"id": "3", "department": "Engineering"}),
                ]
            ),
            finance_key: '\n'.join(
                [
                    json.dumps({"transaction_date": "2026-02-23", "amount": 140, "type": "sale"}),
                    json.dumps({"transaction_date": "2026-02-23", "amount": 60, "type": "expense"}),
                ]
            ),
        }

        response = self.module.lambda_handler(
            {"requestContext": {"http": {"method": "GET"}}, "rawPath": "/dashboard"},
            _context=None,
        )
        body = json.loads(response["body"])

        self.assertEqual(response["statusCode"], 200)
        self.assertIn("metrics", body)
        self.assertIn("charts", body)
        self.assertEqual(body["metrics"]["total_employees"]["value"], 9)
        self.assertGreaterEqual(len(body["charts"]["department_distribution"]), 1)
        self.assertEqual(body["sources"]["latest_prediction_key"], prediction_key)

    def test_forecasts_route_returns_prediction_forecasts(self):
        prediction_key = "trusted-analytics/predictions/2026/02/24/predictions.json"
        self.fake_s3.pages = [
            {"Contents": [{"Key": prediction_key, "LastModified": datetime(2026, 2, 24, 12, 0, tzinfo=timezone.utc)}]}
        ]
        self.fake_s3.objects = {
            prediction_key: json.dumps(
                {
                    "status": "ok",
                    "generated_at": "2026-02-24T12:00:00Z",
                    "insights": {
                        "employee_growth": {"forecast": [{"date": "2026-02-25", "predicted_headcount": 12}]},
                        "finance": {
                            "revenue": {"forecast": [{"date": "2026-02-25", "predicted_revenue": 150.0}]},
                            "expenditure": {"forecast": [{"date": "2026-02-25", "predicted_expenditure": 50.0}]},
                        },
                    },
                }
            )
        }

        response = self.module.lambda_handler(
            {"requestContext": {"http": {"method": "GET"}}, "rawPath": "/forecasts"},
            _context=None,
        )
        body = json.loads(response["body"])
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(body["status"], "ok")
        self.assertEqual(len(body["employee_growth_forecast"]), 1)
        self.assertEqual(len(body["revenue_forecast"]), 1)

    def test_query_route_executes_select_and_returns_rows(self):
        self.fake_athena.query_results["q-1"] = {
            "columns": ["department", "count"],
            "rows": [
                {"department": "Engineering", "count": "10"},
                {"department": "Sales", "count": "5"},
            ],
        }

        response = self.module.lambda_handler(
            {
                "requestContext": {"http": {"method": "POST"}},
                "rawPath": "/query",
                "body": json.dumps({"query": "SELECT department, count(*) AS count FROM employees", "limit": 50}),
            },
            _context=None,
        )
        body = json.loads(response["body"])

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(body["row_count"], 2)
        self.assertEqual(body["columns"], ["department", "count"])
        self.assertIn("LIMIT", self.fake_athena.started_queries[0]["query"].upper())

    def test_query_route_rejects_non_read_only_sql(self):
        response = self.module.lambda_handler(
            {
                "requestContext": {"http": {"method": "POST"}},
                "rawPath": "/query",
                "body": json.dumps({"query": "DELETE FROM employees"}),
            },
            _context=None,
        )
        body = json.loads(response["body"])
        self.assertEqual(response["statusCode"], 400)
        self.assertIn("read-only", body["message"])

    def test_unknown_route_returns_404(self):
        response = self.module.lambda_handler(
            {"requestContext": {"http": {"method": "GET"}}, "rawPath": "/unknown"},
            _context=None,
        )
        self.assertEqual(response["statusCode"], 404)


if __name__ == "__main__":
    unittest.main()
