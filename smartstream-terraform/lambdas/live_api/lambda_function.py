import gzip
import json
import os
from io import BytesIO

import boto3

s3_client = boto3.client("s3")

DATA_LAKE_BUCKET = os.environ["DATA_LAKE_BUCKET"]
TRUSTED_PREFIX = os.environ.get("TRUSTED_PREFIX", "trusted/finance/transactions/")
MAX_ITEMS_DEFAULT = int(os.environ.get("MAX_ITEMS_DEFAULT", "200"))
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")


def _cors_headers():
    return {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
    }


def _response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            **_cors_headers(),
        },
        "body": json.dumps(body),
    }


def _parse_limit(event):
    query = event.get("queryStringParameters") or {}
    raw_limit = query.get("limit")

    if raw_limit is None:
        return MAX_ITEMS_DEFAULT

    try:
        limit = int(raw_limit)
    except (TypeError, ValueError):
        return MAX_ITEMS_DEFAULT

    return max(1, min(limit, MAX_ITEMS_DEFAULT))


def _get_latest_object_key():
    paginator = s3_client.get_paginator("list_objects_v2")
    latest = None

    for page in paginator.paginate(Bucket=DATA_LAKE_BUCKET, Prefix=TRUSTED_PREFIX):
        for obj in page.get("Contents", []):
            if latest is None or obj["LastModified"] > latest["LastModified"]:
                latest = obj

    return latest


def _decode_object_bytes(key, content_bytes):
    if key.endswith(".gz"):
        with gzip.GzipFile(fileobj=BytesIO(content_bytes)) as gz:
            return gz.read().decode("utf-8")
    return content_bytes.decode("utf-8")


def _parse_items(payload):
    payload = payload.strip()
    if not payload:
        return []

    if payload.startswith("["):
        decoded = json.loads(payload)
        return decoded if isinstance(decoded, list) else [decoded]

    items = []
    for line in payload.splitlines():
        line = line.strip()
        if not line:
            continue
        items.append(json.loads(line))
    return items


def lambda_handler(event, _context):
    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")

    if method == "OPTIONS":
        return {
            "statusCode": 200,
            "headers": _cors_headers(),
            "body": "",
        }

    if method != "GET":
        return _response(405, {"message": "Method not allowed"})

    limit = _parse_limit(event)
    latest = _get_latest_object_key()

    if latest is None:
        return _response(200, {"items": [], "s3_key": None, "last_modified": None})

    response = s3_client.get_object(Bucket=DATA_LAKE_BUCKET, Key=latest["Key"])
    raw_bytes = response["Body"].read()
    decoded_text = _decode_object_bytes(latest["Key"], raw_bytes)
    items = _parse_items(decoded_text)

    return _response(
        200,
        {
            "items": items[-limit:],
            "s3_key": latest["Key"],
            "last_modified": latest["LastModified"].isoformat(),
        },
    )
