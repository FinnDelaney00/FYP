import json
import unittest
from datetime import date, datetime, timedelta, timezone

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
                "TRUSTED_PREFIX": "trusted/smartstream-dev/",
                "ANALYTICS_PREFIX": "trusted-analytics/smartstream-dev/predictions/",
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

    def test_parse_datetime_handles_iso_epoch_and_date(self):
        iso = self.module.parse_datetime("2026-01-01T10:00:00Z")
        epoch_ms = self.module.parse_datetime("1704067200000")
        date_only = self.module.parse_datetime("2026-02-24")

        self.assertEqual(iso.tzinfo, timezone.utc)
        self.assertEqual(iso.year, 2026)
        self.assertEqual(epoch_ms.tzinfo, timezone.utc)
        self.assertEqual(date_only.date(), date(2026, 2, 24))
        self.assertEqual(date_only.tzinfo, timezone.utc)

    def test_build_forecast_training_frame_creates_lag_features(self):
        start = date(2026, 1, 1)
        values = {start + timedelta(days=offset): float(100 + offset) for offset in range(30)}
        series = self.module.build_daily_series(values_by_date=values, carry_forward=False)
        frame = self.module.build_forecast_training_frame(series)

        self.assertGreaterEqual(len(frame), 10)
        self.assertEqual(list(frame.columns), ["target", *self.module.FEATURE_COLUMNS])
        self.assertFalse(frame[self.module.FEATURE_COLUMNS].isnull().any().any())

    def test_build_employee_growth_insight_trains_random_forest_forecast(self):
        records = []
        base_day = datetime(2026, 1, 1, tzinfo=timezone.utc)
        for offset in range(28):
            records.append(
                {
                    "id": f"emp-{offset + 1}",
                    "updated_at": (base_day + timedelta(days=offset)).isoformat(),
                    "employment_status": "active",
                }
            )

        result = self.module.build_employee_growth_insight(records, forecast_days=5)

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["model_name"], "RandomForestRegressor")
        self.assertEqual(len(result["forecast"]), 5)
        self.assertEqual(result["forecast"][0]["metric_name"], "employee_headcount")
        self.assertIn("predicted_headcount", result["forecast"][0])
        self.assertIn("lower_bound", result["forecast"][0])
        self.assertIn("upper_bound", result["forecast"][0])
        self.assertIn("lower_ci", result["forecast"][0])
        self.assertIn("upper_ci", result["forecast"][0])
        self.assertEqual(result["forecast"][0]["status"], "ok")

    def test_build_finance_insight_returns_insufficient_data_when_history_is_short(self):
        records = [
            {"transaction_date": "2026-01-01", "amount": "100.00", "type": "sale"},
            {"transaction_date": "2026-01-02", "amount": "$40.00", "type": "expense"},
            {"transaction_date": "2026-01-03", "amount": -20.0},
        ]

        result = self.module.build_finance_insight(records, forecast_days=2)

        self.assertEqual(result["status"], "insufficient_data")
        self.assertEqual(result["revenue"]["status"], "insufficient_data")
        self.assertEqual(result["expenditure"]["status"], "insufficient_data")
        self.assertGreaterEqual(len(result["revenue"]["history"]), 1)
        self.assertEqual(result["revenue"]["forecast"], [])

    def test_build_finance_insight_trains_random_forest_for_revenue_and_expenditure(self):
        records = []
        base_day = date(2026, 1, 1)
        for offset in range(35):
            day = base_day + timedelta(days=offset)
            records.append(
                {
                    "transaction_date": day.isoformat(),
                    "amount": 1000 + (offset * 10),
                    "type": "sale",
                }
            )
            records.append(
                {
                    "transaction_date": day.isoformat(),
                    "amount": 400 + (offset * 5),
                    "type": "expense",
                }
            )

        result = self.module.build_finance_insight(records, forecast_days=4)

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["revenue"]["status"], "ok")
        self.assertEqual(result["expenditure"]["status"], "ok")
        self.assertEqual(len(result["revenue"]["forecast"]), 4)
        self.assertEqual(len(result["expenditure"]["forecast"]), 4)
        self.assertEqual(result["revenue"]["forecast"][0]["model_name"], "RandomForestRegressor")
        self.assertIn("predicted_revenue", result["revenue"]["forecast"][0])
        self.assertIn("predicted_expenditure", result["expenditure"]["forecast"][0])

    def test_parse_records_skips_invalid_json_lines(self):
        payload = "\n".join(
            [
                '{"employee_id": "emp-1"}',
                "{invalid json}",
                '{"employee_id": "emp-2"}',
            ]
        )

        records = self.module.parse_records(payload, "trusted/smartstream-dev/employees/employees/2026/02/24/file.json")

        self.assertEqual(records, [{"employee_id": "emp-1"}, {"employee_id": "emp-2"}])

    def test_read_records_from_objects_skips_corrupted_payload_and_continues(self):
        valid_key = "trusted/smartstream-dev/employees/employees/2026/02/24/valid.json"
        broken_key = "trusted/smartstream-dev/employees/employees/2026/02/24/broken.json.gz"
        now = datetime(2026, 2, 24, 12, 0, tzinfo=timezone.utc)
        objects = [
            {"Key": valid_key, "LastModified": now, "Size": 32},
            {"Key": broken_key, "LastModified": now, "Size": 8},
        ]
        self.fake_s3.objects = {
            valid_key: '{"employee_id": "emp-1", "updated_at": "2026-02-24T12:00:00Z"}',
            broken_key: b"not-a-valid-gzip-stream",
        }

        records = self.module.read_records_from_objects("test-data-lake", objects)

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["employee_id"], "emp-1")
        self.assertEqual(records[0]["_source_key"], valid_key)

    def test_lambda_handler_returns_no_input_data_when_no_objects_exist(self):
        self.fake_s3.pages = [{"Contents": []}]

        response = self.module.lambda_handler({"source": "aws.events"}, context=None)
        body = json.loads(response["body"])

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(body["status"], "no_input_data")
        self.assertEqual(body["rows_processed"], {"employees": 0, "finance": 0})
        self.assertEqual(len(self.fake_s3.put_calls), 1)

    def test_module_rejects_invalid_max_input_files_env(self):
        with self.assertRaises(ValueError):
            load_module(
                relative_path="smartstream-terraform/lambdas/ml/lambda_function.py",
                module_name="ml_inference_lambda_invalid_env",
                fake_s3_client=FakeS3Client(),
                env={
                    "DATA_LAKE_BUCKET": "test-data-lake",
                    "MAX_INPUT_FILES": "0",
                },
            )

    def test_lambda_handler_end_to_end_writes_prediction_payload(self):
        employees_key = "trusted/smartstream-dev/employees/employees/2026/02/24/employees.json"
        finance_key = "trusted/smartstream-dev/finance/transactions/2026/02/24/transactions.json"
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

        employee_lines = []
        finance_lines = []
        base_dt = datetime(2026, 1, 1, 9, 0, tzinfo=timezone.utc)
        base_day = date(2026, 1, 1)
        for offset in range(30):
            employee_lines.append(
                json.dumps(
                    {
                        "id": f"emp-{offset + 1}",
                        "updated_at": (base_dt + timedelta(days=offset)).isoformat(),
                        "employment_status": "active",
                    }
                )
            )
            finance_lines.append(
                json.dumps(
                    {
                        "transaction_id": f"sale-{offset + 1}",
                        "transaction_date": (base_day + timedelta(days=offset)).isoformat(),
                        "amount": 1200 + (offset * 15),
                        "type": "sale",
                    }
                )
            )
            finance_lines.append(
                json.dumps(
                    {
                        "transaction_id": f"exp-{offset + 1}",
                        "transaction_date": (base_day + timedelta(days=offset)).isoformat(),
                        "amount": 500 + (offset * 7),
                        "type": "expense",
                    }
                )
            )

        self.fake_s3.objects = {
            employees_key: "\n".join(employee_lines),
            finance_key: "\n".join(finance_lines),
        }

        response = self.module.lambda_handler({"source": "aws.events"}, context=None)
        body = json.loads(response["body"])

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(body["status"], "ok")
        self.assertIn("output_key", body)
        self.assertEqual(len(self.fake_s3.put_calls), 1)
        self.assertEqual(self.fake_s3.put_calls[0]["Bucket"], "test-data-lake")
        self.assertTrue(
            self.fake_s3.put_calls[0]["Key"].startswith("trusted-analytics/smartstream-dev/predictions/")
        )

        written_payload = json.loads(self.fake_s3.put_calls[0]["Body"].decode("utf-8"))
        self.assertEqual(written_payload["insights"]["employee_growth"]["model_name"], "RandomForestRegressor")
        self.assertEqual(written_payload["insights"]["finance"]["revenue"]["model_name"], "RandomForestRegressor")
        self.assertGreater(len(written_payload["insights"]["employee_growth"]["forecast"]), 0)


if __name__ == "__main__":
    unittest.main()
