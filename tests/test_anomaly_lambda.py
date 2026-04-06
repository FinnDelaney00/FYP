import json
import unittest
from datetime import date, datetime, timedelta, timezone

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
                "FINANCE_PREFIX": "trusted/smartstream-dev/finance/",
                "TRANSACTIONS_PREFIX": "trusted/smartstream-dev/finance/transactions/",
                "ANALYTICS_PREFIX": "trusted-analytics/smartstream-dev/anomalies/",
                "MAX_INPUT_FILES": "20",
            },
        )

    def setUp(self):
        self.fake_s3.objects.clear()
        self.fake_s3.pages = []
        self.fake_s3.put_calls.clear()

    def test_build_anomaly_frame_adds_transaction_features(self):
        rows = []
        start = datetime(2026, 1, 1, 9, 0, tzinfo=timezone.utc)
        for offset in range(25):
            rows.append(
                {
                    "record_id": f"txn-{offset}",
                    "timestamp": start + timedelta(days=offset),
                    "date": (start + timedelta(days=offset)).date(),
                    "amount": float(100 + offset),
                    "signed_amount": float(-(100 + offset)),
                    "source_area": "expenditure",
                    "raw": {"transaction_id": f"txn-{offset}"},
                }
            )

        frame = self.module.build_anomaly_frame(rows, mode="transaction")

        self.assertGreaterEqual(len(frame), 25)
        for column in self.module.TRANSACTION_FEATURE_COLUMNS:
            self.assertIn(column, frame.columns)

    def test_detect_finance_anomalies_prefers_transaction_mode_and_flags_outlier(self):
        records = []
        start = date(2026, 1, 1)
        for offset in range(30):
            amount = 90 + (offset % 5)
            if offset == 24:
                amount = 5000
            records.append(
                {
                    "transaction_id": f"txn-{offset + 1}",
                    "transaction_date": (start + timedelta(days=offset)).isoformat(),
                    "amount": amount,
                    "type": "expense",
                }
            )

        result = self.module.detect_finance_anomalies(records, detected_at=datetime.now(timezone.utc))

        self.assertEqual(result["metadata"]["mode"], "transaction")
        self.assertGreaterEqual(result["metadata"]["rows_modeled"], 20)
        self.assertGreaterEqual(len(result["anomalies"]), 1)
        first = result["anomalies"][0]
        self.assertEqual(first["model_name"], "IsolationForest")
        self.assertTrue(first["anomaly_flag"])
        self.assertIn("anomaly_score", first)
        self.assertIn("source_area", first)
        self.assertIn("title", first)
        self.assertIn("description", first)

    def test_detect_finance_anomalies_falls_back_to_daily_mode(self):
        records = []
        start = date(2026, 1, 1)
        for offset in range(16):
            amount = 800
            if offset == 12:
                amount = 8000
            records.append(
                {
                    "transaction_id": f"txn-{offset + 1}",
                    "transaction_date": (start + timedelta(days=offset)).isoformat(),
                    "amount": amount,
                    "type": "sale",
                }
            )

        result = self.module.detect_finance_anomalies(records, detected_at=datetime.now(timezone.utc))

        self.assertEqual(result["metadata"]["mode"], "daily")
        self.assertGreaterEqual(result["metadata"]["rows_modeled"], 14)
        self.assertGreaterEqual(len(result["anomalies"]), 1)
        self.assertIn(result["anomalies"][0]["anomaly_type"], {"daily_revenue_drop", "daily_total_anomaly"})

    def test_detect_finance_anomalies_returns_insufficient_data_for_empty_records(self):
        result = self.module.detect_finance_anomalies([], detected_at=datetime.now(timezone.utc))

        self.assertEqual(result["status"], "insufficient_data")
        self.assertEqual(result["anomalies"], [])
        self.assertEqual(result["metadata"]["rows_modeled"], 0)

    def test_read_records_from_objects_skips_corrupted_payload_and_continues(self):
        valid_key = "trusted/smartstream-dev/finance/transactions/2026/03/09/valid.json"
        broken_key = "trusted/smartstream-dev/finance/transactions/2026/03/09/broken.json.gz"
        now = datetime(2026, 3, 9, 10, 0, tzinfo=timezone.utc)
        objects = [
            {"Key": valid_key, "LastModified": now},
            {"Key": broken_key, "LastModified": now},
        ]
        self.fake_s3.objects = {
            valid_key: '{"transaction_id":"t-1","transaction_date":"2026-03-09","amount":120,"type":"expense"}',
            broken_key: b"not-a-valid-gzip-stream",
        }

        records = self.module.read_records_from_objects("test-data-lake", objects)

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["transaction_id"], "t-1")
        self.assertEqual(records[0]["_source_key"], valid_key)

    def test_lambda_handler_falls_back_to_finance_prefix_when_transactions_prefix_is_empty(self):
        finance_key = "trusted/smartstream-dev/finance/accounts/2026/03/09/accounts.json"
        now = datetime(2026, 3, 9, 10, 0, tzinfo=timezone.utc)

        self.fake_s3.pages = [{"Contents": [{"Key": finance_key, "LastModified": now}]}]
        self.fake_s3.objects = {
            finance_key: "\n".join(
                json.dumps(
                    {
                        "transaction_id": f"fallback-{offset + 1}",
                        "transaction_date": (date(2026, 1, 1) + timedelta(days=offset)).isoformat(),
                        "amount": 1000 if offset != 10 else 9000,
                        "type": "sale",
                    }
                )
                for offset in range(18)
            )
        }

        response = self.module.lambda_handler({"source": "aws.events"}, context=None)
        body = json.loads(response["body"])
        written_payload = json.loads(self.fake_s3.put_calls[0]["Body"].decode("utf-8"))

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(body["status"], written_payload["status"])
        self.assertIn(finance_key, written_payload["source"]["input_objects"])
        self.assertEqual(len(self.fake_s3.put_calls), 1)

    def test_module_rejects_invalid_max_input_files_env(self):
        with self.assertRaises(ValueError):
            load_module(
                relative_path="smartstream-terraform/lambdas/anomaly/lambda_function.py",
                module_name="anomaly_lambda_invalid_env",
                fake_s3_client=FakeS3Client(),
                env={
                    "DATA_LAKE_BUCKET": "test-data-lake",
                    "MAX_INPUT_FILES": "0",
                },
            )

    def test_lambda_handler_writes_anomaly_payload(self):
        transactions_key = "trusted/smartstream-dev/finance/transactions/2026/03/09/transactions.json"
        now = datetime(2026, 3, 9, 10, 0, tzinfo=timezone.utc)

        self.fake_s3.pages = [{"Contents": [{"Key": transactions_key, "LastModified": now}]}]

        lines = []
        base_day = date(2026, 1, 1)
        for offset in range(28):
            amount = 120 + (offset % 4)
            if offset == 20:
                amount = 6000
            lines.append(
                json.dumps(
                    {
                        "transaction_id": f"t{offset + 1}",
                        "transaction_date": (base_day + timedelta(days=offset)).isoformat(),
                        "amount": amount,
                        "type": "expense",
                    }
                )
            )

        self.fake_s3.objects = {transactions_key: "\n".join(lines)}

        response = self.module.lambda_handler({"source": "aws.events"}, context=None)
        body = json.loads(response["body"])

        self.assertEqual(response["statusCode"], 200)
        self.assertGreater(body["anomaly_count"], 0)
        self.assertEqual(len(self.fake_s3.put_calls), 1)
        self.assertEqual(self.fake_s3.put_calls[0]["Bucket"], "test-data-lake")
        self.assertTrue(
            self.fake_s3.put_calls[0]["Key"].startswith("trusted-analytics/smartstream-dev/anomalies/")
        )

        written_payload = json.loads(self.fake_s3.put_calls[0]["Body"].decode("utf-8"))
        self.assertEqual(written_payload["metadata"]["model_name"], "IsolationForest")
        self.assertGreaterEqual(len(written_payload["anomalies"]), 1)


if __name__ == "__main__":
    unittest.main()
