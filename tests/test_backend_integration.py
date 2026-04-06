import json
from datetime import date, datetime, timedelta, timezone

import pytest

from tests.helpers import FakeS3Client, gzip_bytes, load_module
from tests.test_live_api_lambda import FakeAthenaClient, FakeDynamoResource, FakeGlueClient


def _refresh_s3_pages(fake_s3):
    base_time = datetime(2026, 3, 1, 10, 0, tzinfo=timezone.utc)
    contents = []
    for index, key in enumerate(sorted(fake_s3.objects.keys())):
        payload = fake_s3.objects[key]
        if isinstance(payload, str):
            size = len(payload.encode("utf-8"))
        else:
            size = len(payload)
        contents.append(
            {
                "Key": key,
                "LastModified": base_time + timedelta(minutes=index),
                "Size": size,
            }
        )
    fake_s3.pages = [{"Contents": contents}]


def _load_live_api_module(fake_s3):
    fake_athena = FakeAthenaClient()
    fake_glue = FakeGlueClient()
    fake_glue.tables = [
        {"Name": "trusted", "StorageDescriptor": {"Location": "s3://test-data-lake/trusted/"}},
        {"Name": "acme_trusted", "StorageDescriptor": {"Location": "s3://test-data-lake/trusted/acme/"}},
    ]
    fake_dynamodb = FakeDynamoResource(
        {
            "accounts": "email",
            "anomaly_reviews": "anomaly_id",
            "companies": "company_id",
            "invites": "invite_code",
        }
    )
    module = load_module(
        relative_path="smartstream-terraform/lambdas/live_api/lambda_function.py",
        module_name="live_api_lambda_integration_under_test",
        fake_s3_client=fake_s3,
        fake_clients={"athena": fake_athena, "glue": fake_glue},
        fake_resources={"dynamodb": fake_dynamodb},
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
            "AUTH_TOKEN_SECRET": "integration-secret",
            "AUTH_TOKEN_TTL_SECONDS": "3600",
            "DEFAULT_ACCOUNT_ROLE": "member",
        },
    )
    return module, fake_dynamodb


def _auth_headers(module, fake_dynamodb, *, email, company_id="acme", role="member", display_name="Integration User"):
    company_table = fake_dynamodb.Table("companies")
    company_table.put_item(
        Item={
            "company_id": company_id,
            "company_name": "Acme Ltd",
            "status": "active",
            "trusted_prefix": f"trusted/{company_id}/",
            "analytics_prefix": f"trusted-analytics/{company_id}/",
        }
    )
    account_table = fake_dynamodb.Table("accounts")
    account = {
        "user_id": f"user-{email}",
        "email": email,
        "display_name": display_name,
        "company_id": company_id,
        "role": role,
        "status": "active",
    }
    account_table.put_item(Item=account)
    token = module._issue_token(account)
    return {"authorization": f"Bearer {token}"}


@pytest.mark.integration
def test_raw_to_forecast_to_live_api_workflow():
    fake_s3 = FakeS3Client()
    raw_key = "raw/2026/03/01/source.json.gz"
    raw_lines = []
    start_day = date(2026, 1, 1)

    for offset in range(30):
        raw_lines.append(
            json.dumps(
                {
                    "metadata": {"schema-name": "public", "table-name": "employees"},
                    "data": {
                        "id": f"emp-{offset + 1}",
                        "updated_at": (
                            datetime(2026, 1, 1, 9, 0, tzinfo=timezone.utc) + timedelta(days=offset)
                        ).isoformat(),
                        "employment_status": "active",
                    },
                }
            )
        )
        raw_lines.append(
            json.dumps(
                {
                    "metadata": {"schema-name": "finance", "table-name": "transactions"},
                    "data": {
                        "transaction_id": f"txn-{offset + 1}",
                        "transaction_date": (start_day + timedelta(days=offset)).isoformat(),
                        "amount": 1000 + (offset * 15),
                        "type": "sale",
                    },
                }
            )
        )

    fake_s3.objects[raw_key] = gzip_bytes("\n".join(raw_lines))

    transform_module = load_module(
        relative_path="smartstream-terraform/lambdas/transform/lambda_function.py",
        module_name="transform_lambda_integration_under_test",
        fake_s3_client=fake_s3,
        env={
            "RAW_PREFIX": "raw/",
            "TRUSTED_PREFIX": "trusted/",
            "PIPELINE_COMPANY_ID": "acme",
            "FINANCE_SCHEMA_NAME": "finance",
            "FINANCE_TABLE_LIST": "transactions",
        },
    )
    transform_module.lambda_handler(
        {"Records": [{"s3": {"bucket": {"name": "test-data-lake"}, "object": {"key": raw_key}}}]},
        context=None,
    )

    _refresh_s3_pages(fake_s3)

    ml_module = load_module(
        relative_path="smartstream-terraform/lambdas/ml/lambda_function.py",
        module_name="ml_lambda_integration_under_test",
        fake_s3_client=fake_s3,
        env={
            "DATA_LAKE_BUCKET": "test-data-lake",
            "TRUSTED_PREFIX": "trusted/acme/",
            "ANALYTICS_PREFIX": "trusted-analytics/acme/predictions/",
            "MAX_INPUT_FILES": "20",
            "FORECAST_DAYS": "7",
        },
    )
    ml_response = ml_module.lambda_handler({"source": "aws.events"}, context=None)
    ml_body = json.loads(ml_response["body"])

    _refresh_s3_pages(fake_s3)

    live_api_module, fake_dynamodb = _load_live_api_module(fake_s3)
    headers = _auth_headers(live_api_module, fake_dynamodb, email="member@example.com")

    latest_response = live_api_module.lambda_handler(
        {"requestContext": {"http": {"method": "GET"}}, "rawPath": "/latest", "headers": headers},
        _context=None,
    )
    dashboard_response = live_api_module.lambda_handler(
        {"requestContext": {"http": {"method": "GET"}}, "rawPath": "/dashboard", "headers": headers},
        _context=None,
    )
    forecasts_response = live_api_module.lambda_handler(
        {"requestContext": {"http": {"method": "GET"}}, "rawPath": "/forecasts", "headers": headers},
        _context=None,
    )

    latest_body = json.loads(latest_response["body"])
    dashboard_body = json.loads(dashboard_response["body"])
    forecasts_body = json.loads(forecasts_response["body"])

    assert ml_response["statusCode"] == 200
    assert ml_body["status"] == "partial_data" or ml_body["status"] == "ok"
    assert latest_response["statusCode"] == 200
    assert latest_body["company_id"] == "acme"
    assert len(latest_body["items"]) >= 1
    assert dashboard_response["statusCode"] == 200
    assert dashboard_body["metrics"]["total_employees"]["value"] >= 1
    assert dashboard_body["sources"]["latest_prediction_key"].startswith(
        "trusted-analytics/acme/predictions/"
    )
    assert dashboard_body["sources"]["trusted_prefix"] == "trusted/acme/"
    assert forecasts_response["statusCode"] == 200
    assert forecasts_body["company_id"] == "acme"
    assert len(forecasts_body["employee_growth_forecast"]) == 7


@pytest.mark.integration
def test_trusted_finance_to_anomaly_review_workflow():
    fake_s3 = FakeS3Client()
    finance_key = "trusted/acme/finance/transactions/2026/03/01/transactions.json"
    lines = []

    for offset in range(28):
        amount = 125 + (offset % 4)
        if offset == 19:
            amount = 7000
        lines.append(
            json.dumps(
                {
                    "transaction_id": f"txn-{offset + 1}",
                    "transaction_date": (date(2026, 1, 1) + timedelta(days=offset)).isoformat(),
                    "amount": amount,
                    "type": "expense",
                }
            )
        )

    fake_s3.objects[finance_key] = "\n".join(lines)
    _refresh_s3_pages(fake_s3)

    anomaly_module = load_module(
        relative_path="smartstream-terraform/lambdas/anomaly/lambda_function.py",
        module_name="anomaly_lambda_integration_under_test",
        fake_s3_client=fake_s3,
        env={
            "DATA_LAKE_BUCKET": "test-data-lake",
            "TRUSTED_PREFIX": "trusted/acme/",
            "FINANCE_PREFIX": "trusted/acme/finance/",
            "TRANSACTIONS_PREFIX": "trusted/acme/finance/transactions/",
            "ANALYTICS_PREFIX": "trusted-analytics/acme/anomalies/",
            "MAX_INPUT_FILES": "20",
        },
    )
    anomaly_response = anomaly_module.lambda_handler({"source": "aws.events"}, context=None)

    _refresh_s3_pages(fake_s3)

    live_api_module, fake_dynamodb = _load_live_api_module(fake_s3)
    headers = _auth_headers(live_api_module, fake_dynamodb, email="reviewer@example.com")

    anomalies_response = live_api_module.lambda_handler(
        {"requestContext": {"http": {"method": "GET"}}, "rawPath": "/anomalies", "headers": headers},
        _context=None,
    )
    anomalies_body = json.loads(anomalies_response["body"])
    first_anomaly_id = anomalies_body["items"][0]["anomaly_id"]

    action_response = live_api_module.lambda_handler(
        {
            "requestContext": {"http": {"method": "POST"}},
            "rawPath": f"/anomalies/{first_anomaly_id}/actions",
            "headers": headers,
            "body": json.dumps({"action": "mark_reviewed", "note": "Validated during integration test."}),
        },
        _context=None,
    )
    detail_response = live_api_module.lambda_handler(
        {
            "requestContext": {"http": {"method": "GET"}},
            "rawPath": f"/anomalies/{first_anomaly_id}",
            "headers": headers,
        },
        _context=None,
    )

    action_body = json.loads(action_response["body"])
    detail_body = json.loads(detail_response["body"])
    stored_review = fake_dynamodb.Table("anomaly_reviews").items[f"acme#{first_anomaly_id}"]

    assert anomaly_response["statusCode"] == 200
    assert anomalies_response["statusCode"] == 200
    assert anomalies_body["company_id"] == "acme"
    assert anomalies_body["items"]
    assert action_response["statusCode"] == 200
    assert action_body["item"]["status"] == "reviewed"
    assert stored_review["last_action"] == "mark_reviewed"
    assert stored_review["notes"][0]["note"] == "Validated during integration test."
    assert detail_response["statusCode"] == 200
    assert detail_body["item"]["status"] == "reviewed"
    assert detail_body["item"]["audit_trail"][0]["action"] == "mark_reviewed"
