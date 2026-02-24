import json
import unittest
from unittest.mock import patch

from tests.helpers import FakeS3Client, gzip_bytes, load_module


class TransformLambdaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake_s3 = FakeS3Client()
        cls.module = load_module(
            relative_path="smartstream-terraform/lambdas/transform/lambda_function.py",
            module_name="transform_lambda_under_test",
            fake_s3_client=cls.fake_s3,
            env={
                "FINANCE_SCHEMA_NAME": "finance",
                "FINANCE_TABLE_LIST": "transactions,accounts",
            },
        )

    def setUp(self):
        self.fake_s3.objects.clear()
        self.fake_s3.pages = []
        self.fake_s3.put_calls.clear()

    def test_standardize_timestamps_adds_z_to_naive_iso(self):
        record = {"updated_at": "2026-02-01T12:30:00"}
        normalized = self.module.standardize_timestamps(record)
        self.assertEqual(normalized["updated_at"], "2026-02-01T12:30:00Z")

    def test_standardize_timestamps_converts_epoch_seconds(self):
        record = {"timestamp": 0}
        normalized = self.module.standardize_timestamps(record)
        self.assertEqual(normalized["timestamp"], "1970-01-01T00:00:00Z")

    def test_generate_trusted_key_removes_gzip_and_keeps_json(self):
        key = self.module.generate_trusted_key(
            "raw/2026/02/24/firehose_record.gz",
            "finance/transactions",
        )
        self.assertEqual(
            key,
            "trusted/finance/transactions/2026/02/24/firehose_record.json",
        )

    def test_read_s3_object_supports_plain_and_gzip(self):
        self.fake_s3.objects["raw/plain.json"] = '{"hello":"world"}'
        self.fake_s3.objects["raw/compressed.json.gz"] = gzip_bytes('{"hello":"gzip"}')

        plain = self.module.read_s3_object("bucket", "raw/plain.json")
        compressed = self.module.read_s3_object("bucket", "raw/compressed.json.gz")

        self.assertEqual(plain, '{"hello":"world"}')
        self.assertEqual(compressed, '{"hello":"gzip"}')

    def test_transform_data_filters_routes_and_deduplicates(self):
        employee_envelope = {
            "metadata": {"schema-name": "public", "table-name": "employees"},
            "data": {
                "id": 1,
                "name": "Alice",
                "updated_at": "2026-02-24T10:00:00",
                "optional_field": "",
                "nullable_field": None,
            },
        }
        finance_envelope = {
            "metadata": {"schema-name": "finance", "table-name": "transactions"},
            "data": {"id": "txn-1", "amount": 120.5},
        }
        finance_disallowed_table = {
            "metadata": {"schema-name": "finance", "table-name": "audit"},
            "data": {"id": "skip-me"},
        }
        dms_control_table = {
            "metadata": {"schema-name": "public", "table-name": "awsdms_status"},
            "data": {"heartbeat": "1"},
        }

        raw_lines = [
            json.dumps(employee_envelope),
            json.dumps(employee_envelope),  # duplicate
            json.dumps(finance_envelope),
            json.dumps(finance_disallowed_table),
            json.dumps(dms_control_table),
            "{this is invalid json}",
        ]

        transformed = self.module.transform_data(
            "\n".join(raw_lines),
            source_key="raw/2026/02/24/input.json.gz",
        )

        self.assertEqual(set(transformed.keys()), {"employees/employees", "finance/transactions"})

        employee_records = [json.loads(line) for line in transformed["employees/employees"].splitlines()]
        self.assertEqual(len(employee_records), 1)
        self.assertEqual(employee_records[0]["name"], "Alice")
        self.assertNotIn("optional_field", employee_records[0])
        self.assertNotIn("nullable_field", employee_records[0])
        self.assertEqual(employee_records[0]["updated_at"], "2026-02-24T10:00:00Z")

        finance_records = [json.loads(line) for line in transformed["finance/transactions"].splitlines()]
        self.assertEqual(len(finance_records), 1)
        self.assertEqual(finance_records[0]["id"], "txn-1")

    def test_transform_data_accepts_plain_json_rows(self):
        transformed = self.module.transform_data(
            '{"id": 99, "name": "Standalone"}\n',
            source_key="raw/manual/input.json",
        )
        self.assertIn("employees/employees", transformed)
        rows = [json.loads(line) for line in transformed["employees/employees"].splitlines()]
        self.assertEqual(rows[0]["id"], 99)

    def test_lambda_handler_writes_grouped_output_for_raw_objects(self):
        event = {
            "Records": [
                {"s3": {"bucket": {"name": "demo"}, "object": {"key": "raw/2026/02/24/file.gz"}}},
                {"s3": {"bucket": {"name": "demo"}, "object": {"key": "trusted/ignore.json"}}},
            ]
        }

        with (
            patch.object(self.module, "read_s3_object", return_value="raw-data") as read_mock,
            patch.object(
                self.module,
                "transform_data",
                return_value={"employees/employees": '{"id": 1}'},
            ) as transform_mock,
            patch.object(
                self.module,
                "generate_trusted_key",
                return_value="trusted/employees/employees/2026/02/24/file.json",
            ) as key_mock,
            patch.object(self.module, "write_to_trusted") as write_mock,
        ):
            response = self.module.lambda_handler(event, context=None)

        self.assertEqual(response["statusCode"], 200)
        read_mock.assert_called_once_with("demo", "raw/2026/02/24/file.gz")
        transform_mock.assert_called_once_with("raw-data", source_key="raw/2026/02/24/file.gz")
        key_mock.assert_called_once()
        write_mock.assert_called_once_with(
            "demo",
            "trusted/employees/employees/2026/02/24/file.json",
            '{"id": 1}',
        )

    def test_lambda_handler_skips_write_when_transform_is_empty(self):
        event = {
            "Records": [
                {"s3": {"bucket": {"name": "demo"}, "object": {"key": "raw/2026/02/24/file.gz"}}},
            ]
        }

        with (
            patch.object(self.module, "read_s3_object", return_value="raw-data"),
            patch.object(self.module, "transform_data", return_value={}),
            patch.object(self.module, "write_to_trusted") as write_mock,
        ):
            response = self.module.lambda_handler(event, context=None)

        self.assertEqual(response["statusCode"], 200)
        write_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
