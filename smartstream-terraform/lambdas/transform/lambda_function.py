"""
Lambda function to transform data from S3 raw zone to trusted zone.

This function:
1. Reads raw data files from S3 (triggered by S3 events)
2. Filters out DMS control/heartbeat records (awsdms_*)
3. Keeps only "employees" table events
4. Unwraps DMS envelope -> writes ONLY row fields to trusted zone
5. Removes duplicates and null/empty fields
6. Standardizes timestamp formats
7. Writes cleaned data to S3 trusted zone with deterministic keys
"""

import json
import boto3
import gzip
import hashlib
from datetime import datetime, timezone
from urllib.parse import unquote_plus
from io import BytesIO

s3_client = boto3.client("s3")


def lambda_handler(event, context):
    """
    Main Lambda handler for S3 event triggers.

    Event structure from S3:
    {
        "Records": [
            {
                "s3": {
                    "bucket": {"name": "bucket-name"},
                    "object": {"key": "raw/..."}
                }
            }
        ]
    }
    """
    try:
        for record in event.get("Records", []):
            bucket = record["s3"]["bucket"]["name"]
            key = unquote_plus(record["s3"]["object"]["key"])

            print(f"Processing file: s3://{bucket}/{key}")

            # Only process raw zone inputs
            if not key.startswith("raw/"):
                print(f"Skipping non-raw file: {key}")
                continue

            raw_data = read_s3_object(bucket, key)
            transformed_data = transform_data(raw_data, source_key=key)

            # If nothing survived filtering, don't write empty trusted objects
            if not transformed_data.strip():
                print(f"No valid records after transform. Skipping write for: {key}")
                continue

            trusted_key = generate_trusted_key(key)
            write_to_trusted(bucket, trusted_key, transformed_data)

            print(f"Successfully transformed: {key} -> {trusted_key}")

        return {"statusCode": 200, "body": json.dumps("Transformation completed successfully")}

    except Exception as e:
        print(f"Error during transformation: {str(e)}")
        raise


def read_s3_object(bucket, key):
    """Read and decompress S3 object (handles GZIP from Firehose)."""
    response = s3_client.get_object(Bucket=bucket, Key=key)
    body = response["Body"].read()

    # Handle gzip
    if key.endswith(".gz"):
        with gzip.GzipFile(fileobj=BytesIO(body)) as gzip_file:
            return gzip_file.read().decode("utf-8")
    return body.decode("utf-8")


def transform_data(raw_data, source_key):
    """
    Transform raw data from DMS/Kinesis envelope -> trusted rows.

    Expected raw input: JSON lines format, each line typically like:
    {
      "data": {...employee row...},
      "metadata": {...dms metadata...}
    }
    """
    lines = raw_data.strip().split("\n")
    records = []
    seen_hashes = set()

    for line_num, line in enumerate(lines, 1):
        if not line.strip():
            continue

        try:
            record = json.loads(line)

            # We expect DMS envelope with "metadata" + "data"
            if isinstance(record, dict) and "metadata" in record and "data" in record:
                meta = record.get("metadata") or {}
                table_name = (meta.get("table-name") or "").lower()

                # 1) Drop DMS internal control/heartbeat tables (awsdms_status, etc.)
                if table_name.startswith("awsdms_"):
                    continue

                # 2) Keep only employees table
                if table_name != "employees":
                    continue

                # 3) Keep ONLY the row fields
                cleaned_record = record.get("data") or {}
            else:
                # If a plain row ever arrives, accept it as-is
                cleaned_record = record

            if not isinstance(cleaned_record, dict):
                continue

            # Remove null/empty fields
            cleaned_record = {k: v for k, v in cleaned_record.items() if v is not None and v != ""}

            if not cleaned_record:
                continue

            # Standardize timestamps on common fields (including updated_at)
            cleaned_record = standardize_timestamps(cleaned_record)

            # Deduplicate by content hash
            record_hash = hashlib.md5(json.dumps(cleaned_record, sort_keys=True).encode()).hexdigest()
            if record_hash in seen_hashes:
                continue

            seen_hashes.add(record_hash)
            records.append(cleaned_record)

        except json.JSONDecodeError as e:
            print(f"Line {line_num}: Invalid JSON - {str(e)}")
            continue
        except Exception as e:
            print(f"Line {line_num}: Error transforming record - {str(e)}")
            continue

    print(f"Transformed {len(records)} records from {source_key}")

    # Return as JSON lines (trusted format)
    return "\n".join(json.dumps(r) for r in records)


def standardize_timestamps(record):
    """
    Standardize timestamp fields to ISO 8601 (UTC) where possible.

    If a field is already ISO-like, leave it.
    """
    timestamp_fields = ["timestamp", "created_at", "updated_at", "datetime", "date"]

    for field in timestamp_fields:
        if field not in record:
            continue

        value = record[field]

        try:
            # Keep ISO strings
            if isinstance(value, str) and "T" in value:
                # Ensure Z suffix if it looks like UTC without tz
                # (won't break if it's already with offset)
                if value.endswith("Z") or "+" in value or value.endswith("z"):
                    continue
                # If it's naive, assume UTC
                record[field] = value + "Z"
                continue

            # Convert unix epoch seconds
            if isinstance(value, (int, float)):
                dt = datetime.fromtimestamp(value, tz=timezone.utc)
                record[field] = dt.isoformat().replace("+00:00", "Z")
                continue

        except Exception as e:
            print(f"Warning: Could not parse timestamp field '{field}': {str(e)}")

    return record


def generate_trusted_key(raw_key):
    """
    Generate deterministic S3 key for trusted zone.

    Example:
    raw/year=2026/month=02/day=07/file.gz -> trusted/year=2026/month=02/day=07/file.json
    """
    key_parts = raw_key.replace("raw/", "", 1)

    # Remove gzip extension if present
    if key_parts.endswith(".gz"):
        key_parts = key_parts[:-3]

    # Ensure .json extension
    if not key_parts.endswith(".json"):
        key_parts += ".json"

    return f"trusted/{key_parts}"


def write_to_trusted(bucket, key, data):
    """Write transformed data to S3 trusted zone."""
    s3_client.put_object(
        Bucket=bucket,
        Key=key,
        Body=data.encode("utf-8"),
        ContentType="application/json",
        ServerSideEncryption="AES256",
    )
    print(f"Written {len(data)} bytes to s3://{bucket}/{key}")
