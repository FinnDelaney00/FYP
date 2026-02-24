import json
import unittest
from datetime import datetime, timezone

from tests.helpers import FakeS3Client, gzip_bytes, load_module


class LiveApiLambdaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake_s3 = FakeS3Client()
        cls.module = load_module(
            relative_path="smartstream-terraform/lambdas/live_api/lambda_function.py",
            module_name="live_api_lambda_under_test",
            fake_s3_client=cls.fake_s3,
            env={
                "DATA_LAKE_BUCKET": "test-data-lake",
                "TRUSTED_PREFIX": "trusted/finance/transactions/",
                "MAX_ITEMS_DEFAULT": "200",
                "ALLOWED_ORIGIN": "https://example.com",
            },
        )

    def setUp(self):
        self.fake_s3.objects.clear()
        self.fake_s3.pages = []
        self.fake_s3.put_calls.clear()

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

    def test_lambda_handler_handles_options(self):
        response = self.module.lambda_handler(
            {"requestContext": {"http": {"method": "OPTIONS"}}},
            _context=None,
        )
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(response["body"], "")
        self.assertEqual(response["headers"]["Access-Control-Allow-Origin"], "https://example.com")

    def test_lambda_handler_rejects_non_get(self):
        response = self.module.lambda_handler(
            {"requestContext": {"http": {"method": "POST"}}},
            _context=None,
        )
        body = json.loads(response["body"])
        self.assertEqual(response["statusCode"], 405)
        self.assertEqual(body["message"], "Method not allowed")

    def test_lambda_handler_returns_empty_when_no_objects(self):
        self.fake_s3.pages = [{"Contents": []}]

        response = self.module.lambda_handler(
            {"requestContext": {"http": {"method": "GET"}}},
            _context=None,
        )
        body = json.loads(response["body"])

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(body["items"], [])
        self.assertIsNone(body["s3_key"])
        self.assertIsNone(body["last_modified"])

    def test_lambda_handler_returns_latest_limited_items(self):
        older_key = "trusted/finance/transactions/2026/02/23/old.json"
        newest_key = "trusted/finance/transactions/2026/02/24/new.json.gz"

        self.fake_s3.pages = [
            {
                "Contents": [
                    {
                        "Key": older_key,
                        "LastModified": datetime(2026, 2, 23, 12, 0, tzinfo=timezone.utc),
                    },
                    {
                        "Key": newest_key,
                        "LastModified": datetime(2026, 2, 24, 12, 0, tzinfo=timezone.utc),
                    },
                ]
            }
        ]
        self.fake_s3.objects = {
            older_key: '[{"id":"old"}]',
            newest_key: gzip_bytes(
                "\n".join(
                    [
                        json.dumps({"id": "a"}),
                        json.dumps({"id": "b"}),
                        json.dumps({"id": "c"}),
                    ]
                )
            ),
        }

        response = self.module.lambda_handler(
            {
                "requestContext": {"http": {"method": "GET"}},
                "queryStringParameters": {"limit": "2"},
            },
            _context=None,
        )
        body = json.loads(response["body"])

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(body["s3_key"], newest_key)
        self.assertEqual(len(body["items"]), 2)
        self.assertEqual(body["items"][0]["id"], "b")
        self.assertEqual(body["items"][1]["id"], "c")


if __name__ == "__main__":
    unittest.main()
