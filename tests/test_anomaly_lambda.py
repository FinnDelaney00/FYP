import json
import unittest
from datetime import datetime, timezone

from tests.helpers import FakeS3Client, load_module


class AnomalyLambdaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake_s3 = FakeS3Client()
        cls.module = load_module(
            relative_path="smartstream-terraform/lambdas/anomaly/lambda_function.py",
            module_name="anomaly_lambda_under_test",
            fake_s3_client=cls.fake_s3,
            env={
                "DATA_LAKE_BUCKET": "test-data-lake",
                "TRUSTED_PREFIX": "trusted/smartstream-dev/",
                "EMPLOYEES_PREFIX": "trusted/smartstream-dev/employees/",
                "TRANSACTIONS_PREFIX": "trusted/smartstream-dev/finance/transactions/",
                "ANALYTICS_PREFIX": "trusted-analytics/smartstream-dev/anomalies/",
                "MAX_INPUT_FILES": "20",
                "SALARY_OUTLIER_ZSCORE_THRESHOLD": "2.0",
                "DUPLICATE_TRANSACTION_WINDOW_MINUTES": "10",
                "LARGE_TRANSACTION_MULTIPLIER": "3.0",
                "SMALL_TRANSACTION_FLOOR_RATIO": "0.25",
            },
        )

    def setUp(self):
        self.fake_s3.objects.clear()
        self.fake_s3.pages = []
        self.fake_s3.put_calls.clear()

    def test_detect_salary_outliers_returns_expected_schema(self):
        records = [
            {"id": "e1", "department": "Engineering", "role": "Developer", "salary": 70000},
            {"id": "e2", "department": "Engineering", "role": "Developer", "salary": 72000},
            {"id": "e3", "department": "Engineering", "role": "Developer", "salary": 71000},
            {"id": "e4", "department": "Engineering", "role": "Developer", "salary": 280000},
        ]
        anomalies = self.module.detect_salary_outliers(records, datetime.now(timezone.utc))
        self.assertGreaterEqual(len(anomalies), 1)
        first = anomalies[0]
        self.assertEqual(first["anomaly_type"], "salary_outlier")
        self.assertEqual(first["entity_type"], "employee")
        self.assertIn("actual_value", first["metrics"])

    def test_detect_duplicate_hires_matches_email_and_name(self):
        records = [
            {"id": "e1", "email": "dup@example.com", "full_name": "Alex Kim"},
            {"id": "e2", "email": "dup@example.com", "full_name": "Alex Kim"},
        ]
        anomalies = self.module.detect_duplicate_hires(records, datetime.now(timezone.utc))
        self.assertEqual(len(anomalies), 1)
        self.assertEqual(anomalies[0]["anomaly_type"], "duplicate_hire")
        self.assertEqual(sorted(anomalies[0]["record_ids"]), ["e1", "e2"])

    def test_detect_duplicate_transactions_within_window(self):
        records = [
            {
                "transaction_id": "t1",
                "account_id": "acct-1",
                "vendor": "ACME",
                "amount": 500,
                "transaction_date": "2026-03-01T10:00:00Z",
            },
            {
                "transaction_id": "t2",
                "account_id": "acct-1",
                "vendor": "ACME",
                "amount": 500,
                "transaction_date": "2026-03-01T10:07:00Z",
            },
        ]
        anomalies = self.module.detect_duplicate_transactions(records, datetime.now(timezone.utc))
        self.assertEqual(len(anomalies), 1)
        self.assertEqual(anomalies[0]["anomaly_type"], "duplicate_transaction")
        self.assertEqual(sorted(anomalies[0]["record_ids"]), ["t1", "t2"])

    def test_lambda_handler_writes_anomaly_payload(self):
        employees_key = "trusted/smartstream-dev/employees/employees/2026/03/09/employees.json"
        transactions_key = "trusted/smartstream-dev/finance/transactions/2026/03/09/transactions.json"
        now = datetime(2026, 3, 9, 10, 0, tzinfo=timezone.utc)

        self.fake_s3.pages = [
            {
                "Contents": [
                    {"Key": employees_key, "LastModified": now},
                    {"Key": transactions_key, "LastModified": now},
                ]
            }
        ]
        self.fake_s3.objects = {
            employees_key: "\n".join(
                [
                    json.dumps(
                        {"id": "e1", "department": "Engineering", "role": "Developer", "salary": 70000, "email": "x@example.com"}
                    ),
                    json.dumps(
                        {"id": "e2", "department": "Engineering", "role": "Developer", "salary": 72000, "email": "x@example.com"}
                    ),
                    json.dumps(
                        {"id": "e3", "department": "Engineering", "role": "Developer", "salary": 71000, "email": "y@example.com"}
                    ),
                    json.dumps(
                        {"id": "e4", "department": "Engineering", "role": "Developer", "salary": 250000, "email": "z@example.com"}
                    ),
                ]
            ),
            transactions_key: "\n".join(
                [
                    json.dumps(
                        {
                            "transaction_id": "t1",
                            "account_id": "acct-1",
                            "vendor": "ACME",
                            "amount": 500,
                            "transaction_date": "2026-03-01T10:00:00Z",
                        }
                    ),
                    json.dumps(
                        {
                            "transaction_id": "t2",
                            "account_id": "acct-1",
                            "vendor": "ACME",
                            "amount": 500,
                            "transaction_date": "2026-03-01T10:05:00Z",
                        }
                    ),
                ]
            ),
        }

        response = self.module.lambda_handler({"source": "aws.events"}, context=None)
        body = json.loads(response["body"])

        self.assertEqual(response["statusCode"], 200)
        self.assertGreater(body["anomaly_count"], 0)
        self.assertEqual(len(self.fake_s3.put_calls), 1)
        self.assertEqual(self.fake_s3.put_calls[0]["Bucket"], "test-data-lake")
        self.assertTrue(
            self.fake_s3.put_calls[0]["Key"].startswith("trusted-analytics/smartstream-dev/anomalies/")
        )


if __name__ == "__main__":
    unittest.main()
