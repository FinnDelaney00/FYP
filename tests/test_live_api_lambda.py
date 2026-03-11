import json
import unittest
from datetime import datetime, timezone

from tests.helpers import FakeS3Client, load_module


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

    def start_query_execution(self, QueryString, QueryExecutionContext, WorkGroup, **kwargs):
        self.counter += 1
        query_id = f"q-{self.counter}"
        self.started_queries.append(
            {
                "id": query_id,
                "query": QueryString,
                "database": QueryExecutionContext.get("Database"),
                "workgroup": WorkGroup,
                "result_configuration": kwargs.get("ResultConfiguration"),
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


class FakeGlueClient:
    def __init__(self):
        self.tables = []

    def get_tables(self, DatabaseName, NextToken=None):
        del DatabaseName, NextToken
        return {"TableList": list(self.tables)}


class FakeDynamoTable:
    def __init__(self, key_name):
        self.key_name = key_name
        self.items = {}

    def get_item(self, Key):
        key_value = Key.get(self.key_name)
        item = self.items.get(key_value)
        if item is None:
            return {}
        return {"Item": dict(item)}

    def put_item(self, Item, ConditionExpression=None):
        key_value = Item.get(self.key_name)
        if key_value is None:
            raise ValueError(f"Missing hash key '{self.key_name}' in item.")
        if ConditionExpression and "attribute_not_exists" in ConditionExpression and key_value in self.items:
            raise Exception("ConditionalCheckFailedException")
        self.items[key_value] = dict(Item)
        return {"ResponseMetadata": {"HTTPStatusCode": 200}}

    def update_item(self, Key, UpdateExpression=None, ConditionExpression=None, ExpressionAttributeValues=None):
        ExpressionAttributeValues = ExpressionAttributeValues or {}
        key_value = Key.get(self.key_name)
        item = self.items.get(key_value)

        if ConditionExpression:
            if "attribute_exists(invite_code)" in ConditionExpression and item is None:
                raise Exception("ConditionalCheckFailedException")
            if "(attribute_not_exists(used) OR used = :unused)" in ConditionExpression:
                if item is not None and "used" in item and item.get("used") != ExpressionAttributeValues.get(":unused"):
                    raise Exception("ConditionalCheckFailedException")
            if "(attribute_not_exists(expires_at) OR expires_at >= :now_ts)" in ConditionExpression:
                if item is not None and "expires_at" in item:
                    expires_at = int(item.get("expires_at"))
                    now_ts = int(ExpressionAttributeValues.get(":now_ts"))
                    if expires_at < now_ts:
                        raise Exception("ConditionalCheckFailedException")

        if item is None:
            item = {self.key_name: key_value}

        if UpdateExpression and UpdateExpression.startswith("SET "):
            updates = UpdateExpression[4:].split(",")
            for update in updates:
                field, token = [part.strip() for part in update.split("=", 1)]
                if token not in ExpressionAttributeValues:
                    raise ValueError(f"Missing expression value: {token}")
                item[field] = ExpressionAttributeValues[token]

        self.items[key_value] = dict(item)
        return {"Attributes": dict(item)}

    def delete_item(self, Key):
        key_value = Key.get(self.key_name)
        self.items.pop(key_value, None)
        return {"ResponseMetadata": {"HTTPStatusCode": 200}}


class FakeDynamoResource:
    def __init__(self, key_names_by_table):
        self.key_names_by_table = dict(key_names_by_table)
        self.tables = {}

    def Table(self, name):
        if name not in self.tables:
            key_name = self.key_names_by_table.get(name, "id")
            self.tables[name] = FakeDynamoTable(key_name)
        return self.tables[name]


class LiveApiLambdaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake_s3 = FakeS3Client()
        cls.fake_athena = FakeAthenaClient()
        cls.fake_glue = FakeGlueClient()
        cls.table_keys = {
            "accounts": "email",
            "anomaly_reviews": "anomaly_id",
            "companies": "company_id",
            "invites": "invite_code",
        }
        cls.fake_dynamodb = FakeDynamoResource(cls.table_keys)
        cls.module = load_module(
            relative_path="smartstream-terraform/lambdas/live_api/lambda_function.py",
            module_name="live_api_lambda_under_test",
            fake_s3_client=cls.fake_s3,
            fake_clients={"athena": cls.fake_athena, "glue": cls.fake_glue},
            fake_resources={"dynamodb": cls.fake_dynamodb},
            env={
                "DATA_LAKE_BUCKET": "test-data-lake",
                "TRUSTED_ROOT_PREFIX": "trusted/",
                "TRUSTED_ANALYTICS_ROOT_PREFIX": "trusted-analytics/",
                "MAX_ITEMS_DEFAULT": "200",
                "QUERY_MAX_ROWS": "100",
                "ALLOWED_ORIGIN": "https://example.com",
                "ATHENA_WORKGROUP": "wg-test",
                "ATHENA_DATABASE": "db_test",
                "ACCOUNTS_TABLE": "accounts",
                "ANOMALY_REVIEWS_TABLE": "anomaly_reviews",
                "COMPANIES_TABLE": "companies",
                "INVITES_TABLE": "invites",
                "AUTH_TOKEN_SECRET": "unit-test-secret",
                "AUTH_TOKEN_TTL_SECONDS": "3600",
                "DEFAULT_ACCOUNT_ROLE": "member",
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
        self.fake_glue.tables = [
            {"Name": "trusted", "StorageDescriptor": {"Location": "s3://test-data-lake/trusted/"}},
            {"Name": "acme_trusted", "StorageDescriptor": {"Location": "s3://test-data-lake/trusted/acme/"}},
            {"Name": "beta_trusted", "StorageDescriptor": {"Location": "s3://test-data-lake/trusted/beta/"}},
        ]
        self.module._resolve_trusted_query_target.cache_clear()
        for table_name in self.table_keys:
            self.fake_dynamodb.Table(table_name).items.clear()

    def _table(self, name):
        return self.fake_dynamodb.Table(name)

    def _event(self, method, path, body=None, headers=None, query=None):
        event = {
            "requestContext": {"http": {"method": method}},
            "rawPath": path,
        }
        if body is not None:
            event["body"] = json.dumps(body)
        if headers:
            event["headers"] = dict(headers)
        if query is not None:
            event["queryStringParameters"] = dict(query)
        return event

    def _create_company(self, company_id="acme", status="active", name="Acme Ltd"):
        self._table("companies").put_item(
            Item={
                "company_id": company_id,
                "company_name": name,
                "status": status,
                "trusted_prefix": f"trusted/{company_id}/",
                "analytics_prefix": f"trusted-analytics/{company_id}/",
            }
        )

    def _create_invite(self, invite_code="INVITE1234", company_id="acme", role="member", expires_at=None, used=False):
        if expires_at is None:
            expires_at = int(datetime(2030, 1, 1, tzinfo=timezone.utc).timestamp())
        self._table("invites").put_item(
            Item={
                "invite_code": invite_code,
                "company_id": company_id,
                "role": role,
                "expires_at": expires_at,
                "used": used,
                "used_by": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )

    def _create_account(self, email, company_id="acme", role="member", display_name="Test User", status="active"):
        salt_hex, hash_hex = self.module._hash_password("Password123")
        now_iso = datetime.now(timezone.utc).isoformat()
        item = {
            "user_id": f"user-{email}",
            "email": email,
            "display_name": display_name,
            "password_salt": salt_hex,
            "password_hash": hash_hex,
            "company_id": company_id,
            "role": role,
            "status": status,
            "created_at": now_iso,
            "updated_at": now_iso,
        }
        self._table("accounts").put_item(Item=item)
        return item

    def _auth_headers(self, email):
        account = self._table("accounts").items[email]
        token = self.module._issue_token(account)
        return {"authorization": f"Bearer {token}"}

    def test_signup_fails_with_invalid_invite_code(self):
        self._create_company("acme")
        response = self.module.lambda_handler(
            self._event(
                "POST",
                "/auth/signup",
                body={"email": "new@example.com", "password": "Password123", "invite_code": "BADCODE"},
            ),
            _context=None,
        )
        self.assertEqual(response["statusCode"], 400)
        self.assertNotIn("new@example.com", self._table("accounts").items)

    def test_signup_succeeds_with_valid_invite_and_stores_company(self):
        self._create_company("acme")
        self._create_invite(invite_code="INVITE1234", company_id="acme", role="analyst")
        response = self.module.lambda_handler(
            self._event(
                "POST",
                "/auth/signup",
                body={
                    "email": "new@example.com",
                    "password": "Password123",
                    "display_name": "New User",
                    "invite_code": "INVITE1234",
                    "company_id": "forged-from-client",
                },
            ),
            _context=None,
        )
        body = json.loads(response["body"])
        stored_user = self._table("accounts").items["new@example.com"]
        invite = self._table("invites").items["INVITE1234"]

        self.assertEqual(response["statusCode"], 201)
        self.assertEqual(body["user"]["company_id"], "acme")
        self.assertEqual(body["user"]["role"], "analyst")
        self.assertEqual(stored_user["company_id"], "acme")
        self.assertEqual(stored_user["role"], "analyst")
        self.assertTrue(invite["used"])
        self.assertEqual(invite["used_by"], "new@example.com")

    def test_invite_cannot_be_reused(self):
        self._create_company("acme")
        self._create_invite(invite_code="INVITE1234", company_id="acme")

        first = self.module.lambda_handler(
            self._event(
                "POST",
                "/auth/signup",
                body={"email": "first@example.com", "password": "Password123", "invite_code": "INVITE1234"},
            ),
            _context=None,
        )
        second = self.module.lambda_handler(
            self._event(
                "POST",
                "/auth/signup",
                body={"email": "second@example.com", "password": "Password123", "invite_code": "INVITE1234"},
            ),
            _context=None,
        )

        self.assertEqual(first["statusCode"], 201)
        self.assertEqual(second["statusCode"], 400)
        self.assertNotIn("second@example.com", self._table("accounts").items)

    def test_login_token_includes_company_id_and_role(self):
        self._create_company("acme")
        self._create_account("login@example.com", company_id="acme", role="analyst")

        response = self.module.lambda_handler(
            self._event("POST", "/auth/login", body={"email": "login@example.com", "password": "Password123"}),
            _context=None,
        )
        body = json.loads(response["body"])
        claims = self.module._verify_token(body["token"])

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(claims["company_id"], "acme")
        self.assertEqual(claims["role"], "analyst")

    def test_auth_me_returns_company_and_role(self):
        self._create_company("acme")
        self._create_account("me@example.com", company_id="acme", role="viewer", display_name="Viewer")
        response = self.module.lambda_handler(
            self._event("GET", "/auth/me", headers=self._auth_headers("me@example.com")),
            _context=None,
        )
        body = json.loads(response["body"])
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(body["user"]["company_id"], "acme")
        self.assertEqual(body["user"]["role"], "viewer")
        self.assertEqual(body["company"]["company_id"], "acme")

    def test_protected_routes_reject_missing_or_invalid_auth(self):
        self._create_company("acme")
        self._create_account("member@example.com", company_id="acme")

        missing = self.module.lambda_handler(self._event("GET", "/latest"), _context=None)
        invalid = self.module.lambda_handler(
            self._event("GET", "/latest", headers={"authorization": "Bearer invalid-token"}),
            _context=None,
        )

        self.assertEqual(missing["statusCode"], 401)
        self.assertEqual(invalid["statusCode"], 401)

    def test_protected_routes_ignore_forged_client_company_id(self):
        self._create_company("acme")
        self._create_company("beta")
        self._create_account("member@example.com", company_id="acme")

        acme_key = "trusted/acme/finance/transactions/2026/02/24/acme.json"
        beta_key = "trusted/beta/finance/transactions/2026/02/24/beta.json"
        self.fake_s3.pages = [
            {
                "Contents": [
                    {"Key": acme_key, "LastModified": datetime(2026, 2, 24, 10, 0, tzinfo=timezone.utc)},
                    {"Key": beta_key, "LastModified": datetime(2026, 2, 24, 11, 0, tzinfo=timezone.utc)},
                ]
            }
        ]
        self.fake_s3.objects = {
            acme_key: json.dumps([{"id": "acme-1"}]),
            beta_key: json.dumps([{"id": "beta-1"}]),
        }

        latest = self.module.lambda_handler(
            self._event(
                "GET",
                "/latest",
                headers=self._auth_headers("member@example.com"),
                query={"company_id": "beta"},
            ),
            _context=None,
        )
        latest_body = json.loads(latest["body"])

        self.fake_athena.query_results["q-1"] = {"columns": ["id"], "rows": [{"id": "x"}]}
        query_response = self.module.lambda_handler(
            self._event(
                "POST",
                "/query",
                headers=self._auth_headers("member@example.com"),
                body={
                    "query": "SELECT * FROM trusted WHERE \"$path\" LIKE '%/trusted/beta/finance/transactions/%' LIMIT 5",
                    "company_id": "beta",
                    "limit": 10,
                },
            ),
            _context=None,
        )

        self.assertEqual(latest["statusCode"], 200)
        self.assertEqual(latest_body["s3_key"], acme_key)
        self.assertEqual(query_response["statusCode"], 200)
        self.assertIn('FROM "acme_trusted"', self.fake_athena.started_queries[0]["query"])
        self.assertNotIn('FROM "beta_trusted"', self.fake_athena.started_queries[0]["query"])

    def test_query_rejects_non_read_only_sql(self):
        self._create_company("acme")
        self._create_account("member@example.com", company_id="acme")

        response = self.module.lambda_handler(
            self._event(
                "POST",
                "/query",
                headers=self._auth_headers("member@example.com"),
                body={"query": "DELETE FROM trusted"},
            ),
            _context=None,
        )
        body = json.loads(response["body"])

        self.assertEqual(response["statusCode"], 400)
        self.assertIn("read-only", body["message"])

    def test_query_falls_back_to_root_trusted_table_when_tenant_table_missing(self):
        self._create_company("acme")
        self._create_account("member@example.com", company_id="acme")
        self.fake_glue.tables = [
            {"Name": "trusted", "StorageDescriptor": {"Location": "s3://test-data-lake/trusted/"}}
        ]
        self.module._resolve_trusted_query_target.cache_clear()
        self.fake_athena.query_results["q-1"] = {"columns": ["id"], "rows": [{"id": "x"}]}

        response = self.module.lambda_handler(
            self._event(
                "POST",
                "/query",
                headers=self._auth_headers("member@example.com"),
                body={"query": "SELECT * FROM trusted LIMIT 1"},
            ),
            _context=None,
        )

        self.assertEqual(response["statusCode"], 200)
        self.assertIn('FROM "trusted" WHERE "$path" LIKE \'%/trusted/acme/%\'', self.fake_athena.started_queries[0]["query"])

    def test_admin_can_create_invites_only_for_own_company(self):
        self._create_company("acme")
        self._create_company("beta")
        self._create_account("admin@example.com", company_id="acme", role="admin", display_name="Admin")

        response = self.module.lambda_handler(
            self._event(
                "POST",
                "/admin/invites",
                headers=self._auth_headers("admin@example.com"),
                body={"role": "viewer", "expires_in_days": 7, "company_id": "beta"},
            ),
            _context=None,
        )
        body = json.loads(response["body"])
        invite_code = body["invite"]["invite_code"]
        stored_invite = self._table("invites").items[invite_code]

        self.assertEqual(response["statusCode"], 201)
        self.assertEqual(body["invite"]["company_id"], "acme")
        self.assertEqual(stored_invite["company_id"], "acme")
        self.assertEqual(stored_invite["role"], "viewer")

    def test_non_admin_cannot_create_invites(self):
        self._create_company("acme")
        self._create_account("member@example.com", company_id="acme", role="member")

        response = self.module.lambda_handler(
            self._event(
                "POST",
                "/admin/invites",
                headers=self._auth_headers("member@example.com"),
                body={"role": "member"},
            ),
            _context=None,
        )
        self.assertEqual(response["statusCode"], 403)

    def test_inactive_company_returns_403(self):
        self._create_company("acme", status="inactive")
        self._create_account("member@example.com", company_id="acme", role="member")

        response = self.module.lambda_handler(
            self._event("GET", "/latest", headers=self._auth_headers("member@example.com")),
            _context=None,
        )
        self.assertEqual(response["statusCode"], 403)

    def test_data_path_resolution_is_company_scoped(self):
        self._create_company("acme")
        self._create_company("beta")
        self._create_account("member@example.com", company_id="acme", role="member")

        acme_finance_key = "trusted/acme/finance/transactions/2026/03/01/finance.json"
        beta_finance_key = "trusted/beta/finance/transactions/2026/03/01/finance.json"
        acme_prediction_key = "trusted-analytics/acme/predictions/2026/03/01/predictions.json"
        beta_prediction_key = "trusted-analytics/beta/predictions/2026/03/01/predictions.json"
        acme_anomaly_key = "trusted-analytics/acme/anomalies/2026/03/01/anomalies.json"
        beta_anomaly_key = "trusted-analytics/beta/anomalies/2026/03/01/anomalies.json"

        self.fake_s3.pages = [
            {
                "Contents": [
                    {"Key": acme_finance_key, "LastModified": datetime(2026, 3, 1, 10, 0, tzinfo=timezone.utc)},
                    {"Key": beta_finance_key, "LastModified": datetime(2026, 3, 1, 11, 0, tzinfo=timezone.utc)},
                    {"Key": acme_prediction_key, "LastModified": datetime(2026, 3, 1, 10, 0, tzinfo=timezone.utc)},
                    {"Key": beta_prediction_key, "LastModified": datetime(2026, 3, 1, 11, 0, tzinfo=timezone.utc)},
                    {"Key": acme_anomaly_key, "LastModified": datetime(2026, 3, 1, 10, 0, tzinfo=timezone.utc)},
                    {"Key": beta_anomaly_key, "LastModified": datetime(2026, 3, 1, 11, 0, tzinfo=timezone.utc)},
                ]
            }
        ]
        self.fake_s3.objects = {
            acme_finance_key: json.dumps([{"id": "acme-finance"}]),
            beta_finance_key: json.dumps([{"id": "beta-finance"}]),
            acme_prediction_key: json.dumps(
                {
                    "status": "ok",
                    "generated_at": "2026-03-01T10:00:00Z",
                    "diagnostics": {"rows_processed": {"employees": 5, "finance": 5}},
                    "insights": {"employee_growth": {"history": [], "forecast": []}, "finance": {"revenue": {}, "expenditure": {}}},
                }
            ),
            beta_prediction_key: json.dumps({"status": "ok", "generated_at": "2026-03-01T11:00:00Z"}),
            acme_anomaly_key: json.dumps(
                {
                    "generated_at": "2026-03-01T10:00:00Z",
                    "anomalies": [
                        {
                            "anomaly_id": "acme-a1",
                            "entity_type": "transaction",
                            "severity": "high",
                            "status": "new",
                            "anomaly_type": "large_transaction",
                            "record_ids": ["r-1"],
                            "reasons": ["outlier"],
                            "detected_at": "2026-03-01T09:59:00Z",
                        }
                    ],
                }
            ),
            beta_anomaly_key: json.dumps(
                {
                    "generated_at": "2026-03-01T11:00:00Z",
                    "anomalies": [{"anomaly_id": "beta-a1", "severity": "low"}],
                }
            ),
        }

        latest = self.module.lambda_handler(
            self._event("GET", "/latest", headers=self._auth_headers("member@example.com")),
            _context=None,
        )
        forecasts = self.module.lambda_handler(
            self._event("GET", "/forecasts", headers=self._auth_headers("member@example.com")),
            _context=None,
        )
        anomalies = self.module.lambda_handler(
            self._event("GET", "/anomalies", headers=self._auth_headers("member@example.com")),
            _context=None,
        )

        latest_body = json.loads(latest["body"])
        forecasts_body = json.loads(forecasts["body"])
        anomalies_body = json.loads(anomalies["body"])

        self.assertEqual(latest["statusCode"], 200)
        self.assertEqual(forecasts["statusCode"], 200)
        self.assertEqual(anomalies["statusCode"], 200)
        self.assertEqual(latest_body["s3_key"], acme_finance_key)
        self.assertEqual(forecasts_body["source_key"], acme_prediction_key)
        self.assertEqual(anomalies_body["s3_key"], acme_anomaly_key)
        self.assertEqual(anomalies_body["items"][0]["anomaly_id"], "acme-a1")


if __name__ == "__main__":
    unittest.main()
