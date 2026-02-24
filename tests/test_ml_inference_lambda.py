import json
import unittest
from datetime import date, datetime, timezone

from tests.helpers import FakeS3Client, load_module


class MLInferenceLambdaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake_s3 = FakeS3Client()
        cls.module = load_module(
            relative_path="smartstream-terraform/lambdas/ml/lambda_function.py",
            module_name="ml_inference_lambda_under_test",
            fake_s3_client=cls.fake_s3,
            env={
                "DATA_LAKE_BUCKET": "test-data-lake",
                "TRUSTED_PREFIX": "trusted/",
                "ANALYTICS_PREFIX": "trusted-analytics/predictions/",
                "MAX_INPUT_FILES": "20",
                "FORECAST_DAYS": "7",
            },
        )

    def setUp(self):
        self.fake_s3.objects.clear()
        self.fake_s3.pages = []
        self.fake_s3.put_calls.clear()

    def test_parse_bool_supports_multiple_truthy_and_falsy_values(self):
        self.assertTrue(self.module.parse_bool("yes"))
        self.assertTrue(self.module.parse_bool(1))
        self.assertFalse(self.module.parse_bool("terminated"))
        self.assertFalse(self.module.parse_bool(0))
        self.assertIsNone(self.module.parse_bool("maybe"))

    def test_parse_float_parses_currency_and_rejects_invalid(self):
        self.assertEqual(self.module.parse_float("$1,250.50"), 1250.5)
        self.assertEqual(self.module.parse_float(42), 42.0)
        self.assertIsNone(self.module.parse_float("not-a-number"))
        self.assertIsNone(self.module.parse_float(""))

    def test_parse_datetime_handles_iso_epoch_and_date(self):
        iso = self.module.parse_datetime("2026-01-01T10:00:00Z")
        epoch_ms = self.module.parse_datetime("1704067200000")
        date_only = self.module.parse_datetime("2026-02-24")

        self.assertEqual(iso.tzinfo, timezone.utc)
        self.assertEqual(iso.year, 2026)
        self.assertEqual(epoch_ms.tzinfo, timezone.utc)
        self.assertEqual(date_only.date(), date(2026, 2, 24))
        self.assertEqual(date_only.tzinfo, timezone.utc)

    def test_extract_date_from_key_parses_partitioned_paths(self):
        parsed = self.module.extract_date_from_key("trusted/employees/table/2026/02/24/file.json")
        missing = self.module.extract_date_from_key("trusted/employees/table/no-date/file.json")
        self.assertEqual(parsed, date(2026, 2, 24))
        self.assertIsNone(missing)

    def test_extract_record_datetime_uses_fallbacks(self):
        from_timestamp_field = self.module.extract_record_datetime({"updated_at": "2026-03-01T00:00:00Z"})
        from_source_key = self.module.extract_record_datetime(
            {"_source_key": "trusted/employees/x/2026/03/02/object.json"}
        )
        from_modified = self.module.extract_record_datetime(
            {"_source_last_modified": "2026-03-03T09:00:00+00:00"}
        )

        self.assertEqual(from_timestamp_field.date(), date(2026, 3, 1))
        self.assertEqual(from_source_key.date(), date(2026, 3, 2))
        self.assertEqual(from_modified.date(), date(2026, 3, 3))

    def test_classify_finance_amount_prefers_hints_then_sign(self):
        revenue = self.module.classify_finance_amount({"type": "sales_credit"}, -20.0)
        expenditure = self.module.classify_finance_amount({"category": "purchase"}, 50.0)
        fallback_revenue = self.module.classify_finance_amount({}, 10.0)
        fallback_expenditure = self.module.classify_finance_amount({}, -10.0)

        self.assertEqual(revenue, "revenue")
        self.assertEqual(expenditure, "expenditure")
        self.assertEqual(fallback_revenue, "revenue")
        self.assertEqual(fallback_expenditure, "expenditure")

    def test_build_daily_history_handles_carry_forward_and_reset(self):
        values = {
            date(2026, 1, 1): 2.0,
            date(2026, 1, 3): 4.0,
        }

        carry = self.module.build_daily_history(
            values_by_date=values,
            value_name="headcount",
            carry_forward=True,
            integer_output=True,
        )
        reset = self.module.build_daily_history(
            values_by_date=values,
            value_name="revenue",
            carry_forward=False,
            integer_output=False,
        )

        self.assertEqual(carry[1]["headcount"], 2)
        self.assertEqual(carry[2]["headcount"], 4)
        self.assertEqual(reset[1]["revenue"], 0.0)
        self.assertEqual(reset[2]["revenue"], 4.0)

    def test_fit_linear_trend_and_forecast_series(self):
        slope, intercept, residual_std = self.module.fit_linear_trend([10.0, 20.0, 30.0, 40.0])
        self.assertGreater(slope, 0.0)
        self.assertGreaterEqual(intercept, 0.0)
        self.assertGreaterEqual(residual_std, 0.0)

        history = [
            {"date": "2026-01-01", "headcount": 10},
            {"date": "2026-01-02", "headcount": 12},
            {"date": "2026-01-03", "headcount": 14},
        ]
        forecast = self.module.forecast_series(
            history=history,
            history_key="headcount",
            prediction_key="predicted_headcount",
            forecast_days=5,
            integer_output=True,
        )

        self.assertEqual(len(forecast), 5)
        self.assertIn("predicted_headcount", forecast[0])
        self.assertGreaterEqual(forecast[0]["lower_ci"], 0)
        self.assertGreaterEqual(forecast[0]["upper_ci"], forecast[0]["lower_ci"])

    def test_parse_records_supports_json_object_array_and_json_lines(self):
        parsed_object = self.module.parse_records('{"id": 1}', "obj.json")
        parsed_array = self.module.parse_records('[{"id": 1}, {"id": 2}]', "arr.json")
        parsed_lines = self.module.parse_records('{"id":1}\n{"id":2}\ninvalid', "lines.json")

        self.assertEqual(len(parsed_object), 1)
        self.assertEqual(len(parsed_array), 2)
        self.assertEqual(len(parsed_lines), 2)

    def test_build_employee_growth_insight_reports_insufficient_data(self):
        result = self.module.build_employee_growth_insight([], forecast_days=3)
        self.assertEqual(result["status"], "insufficient_data")
        self.assertEqual(result["history"], [])
        self.assertEqual(result["forecast"], [])

    def test_build_employee_growth_insight_tracks_active_headcount(self):
        records = [
            {"id": "1", "updated_at": "2026-01-01T00:00:00Z", "employment_status": "active"},
            {"id": "2", "updated_at": "2026-01-02T00:00:00Z", "employment_status": "active"},
            {"id": "1", "updated_at": "2026-01-03T00:00:00Z", "employment_status": "terminated"},
        ]
        result = self.module.build_employee_growth_insight(records, forecast_days=3)

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["rows_used"], 3)
        self.assertEqual(result["history"][-1]["headcount"], 1)
        self.assertEqual(len(result["forecast"]), 3)

    def test_build_finance_insight_handles_mixed_revenue_and_expenditure(self):
        records = [
            {"transaction_date": "2026-01-01", "amount": "100.00", "type": "sale"},
            {"transaction_date": "2026-01-01", "amount": "$40.00", "type": "expense"},
            {"transaction_date": "2026-01-02", "amount": -20.0},
        ]
        result = self.module.build_finance_insight(records, forecast_days=2)

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["rows_used"], 3)
        self.assertEqual(result["revenue"]["status"], "ok")
        self.assertEqual(result["expenditure"]["status"], "ok")
        self.assertEqual(len(result["revenue"]["forecast"]), 2)
        self.assertEqual(len(result["expenditure"]["forecast"]), 2)

    def test_build_finance_insight_returns_insufficient_for_unusable_rows(self):
        records = [
            {"transaction_date": "", "amount": None},
            {"note": "missing finance fields"},
        ]
        result = self.module.build_finance_insight(records, forecast_days=2)

        self.assertEqual(result["status"], "insufficient_data")
        self.assertEqual(result["revenue"]["history"], [])
        self.assertEqual(result["expenditure"]["history"], [])

    def test_lambda_handler_end_to_end_writes_prediction_payload(self):
        employees_key = "trusted/employees/employees/2026/02/24/employees.json"
        finance_key = "trusted/finance/transactions/2026/02/24/transactions.json"

        self.fake_s3.pages = [
            {
                "Contents": [
                    {
                        "Key": employees_key,
                        "LastModified": datetime(2026, 2, 24, 10, 0, tzinfo=timezone.utc),
                        "Size": 200,
                    },
                    {
                        "Key": finance_key,
                        "LastModified": datetime(2026, 2, 24, 10, 5, tzinfo=timezone.utc),
                        "Size": 180,
                    },
                ]
            }
        ]
        self.fake_s3.objects = {
            employees_key: (
                '{"id":"1","updated_at":"2026-02-24T09:00:00Z","employment_status":"active"}\n'
                '{"id":"2","updated_at":"2026-02-24T10:00:00Z","employment_status":"active"}\n'
                '{"id":"1","updated_at":"2026-02-24T11:00:00Z","employment_status":"terminated"}'
            ),
            finance_key: (
                '{"transaction_date":"2026-02-24","amount":120.0,"type":"sale"}\n'
                '{"transaction_date":"2026-02-24","amount":45.0,"type":"expense"}'
            ),
        }

        response = self.module.lambda_handler({"source": "aws.events"}, context=None)
        body = json.loads(response["body"])

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(body["status"], "ok")
        self.assertIn("output_key", body)
        self.assertEqual(len(self.fake_s3.put_calls), 1)
        self.assertEqual(self.fake_s3.put_calls[0]["Bucket"], "test-data-lake")
        self.assertTrue(self.fake_s3.put_calls[0]["Key"].startswith("trusted-analytics/predictions/"))


if __name__ == "__main__":
    unittest.main()
