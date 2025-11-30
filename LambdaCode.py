import json
import uuid
from datetime import datetime, timezone

import boto3

s3 = boto3.client("s3")

# Where the transformed data will be written
TRUSTED_PREFIX = "data/trusted/"


def parse_raw_body(body: str):
    """
    Parse the DMS/Firehose file body into a list of JSON objects.

    Handles:
      - A single pretty-printed JSON object
      - Multiple JSON objects concatenated in the file, with or without newlines
    """
    body = body.strip()
    if not body:
        return []

    records = []
    decoder = json.JSONDecoder()
    idx = 0
    length = len(body)

    while idx < length:
        # Skip whitespace between JSON objects
        while idx < length and body[idx].isspace():
            idx += 1
        if idx >= length:
            break

        try:
            obj, end = decoder.raw_decode(body, idx)
        except json.JSONDecodeError as e:
            print(f"Failed to decode JSON chunk at pos {idx}: {e}")
            break

        records.append(obj)
        idx = end

    print(f"parse_raw_body: decoded {len(records)} JSON objects from {length} chars")
    return records


def transform_record(raw_record: dict):
    """
    Convert one DMS record into a clean trusted-layer record.

    Expected structure:
    {
      "data": { ... row values ... },
      "metadata": {
         "timestamp": "...",
         "record-type": "data",
         "operation": "insert" | "update" | "delete",
         "schema-name": "...",
         "table-name": "...",
         "transaction-id": ...
      }
    }
    """
    metadata = raw_record.get("metadata", {})
    if metadata.get("record-type") != "data":
        # Skip control/transaction records
        return None

    data = raw_record.get("data", {})
    op_type = metadata.get("operation")
    src_ts = metadata.get("timestamp")

    trusted = {
        "id": data.get("id"),
        "education": data.get("education"),
        "joining_year": data.get("joiningyear"),
        "city": data.get("city"),
        "payment_tier": data.get("paymenttier"),
        "age": data.get("age"),
        "gender": data.get("gender"),
        # normalise everbenched to boolean
        "ever_benched": str(data.get("everbenched", "")).lower() == "yes",
        "experience_years": data.get("experienceincurrentdomain"),
        "leave_or_not": data.get("leaveornot"),

        "op_type": op_type,
        "source_timestamp": src_ts,
        "ingest_timestamp": datetime.now(timezone.utc).isoformat(),
        "schema_name": metadata.get("schema-name"),
        "table_name": metadata.get("table-name"),
        "transaction_id": metadata.get("transaction-id"),
    }

    return trusted


def process_s3_object(bucket: str, key: str):
    """
    Read a raw S3 object, transform its contents, and write a trusted file.
    """
    print(f"Processing s3://{bucket}/{key}")

    obj = s3.get_object(Bucket=bucket, Key=key)
    body_bytes = obj["Body"].read()
    print(f"Raw object size (bytes): {len(body_bytes)}")

    # If you ever enable gzip compression for Firehose, swap this to gzip.decompress(...)
    body = body_bytes.decode("utf-8")

    raw_records = parse_raw_body(body)
    print(f"Parsed {len(raw_records)} raw records")

    trusted_records = []
    for raw in raw_records:
        trusted = transform_record(raw)
        if trusted is not None:
            trusted_records.append(trusted)

    if not trusted_records:
        print("No trusted records produced from file; skipping write.")
        return

    # Newline-delimited JSON for Athena/Glue
    trusted_body = "\n".join(json.dumps(r) for r in trusted_records)

    # Partition by ingest_date for Glue/Athena
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out_key = (
        f"{TRUSTED_PREFIX}"
        f"ingest_date={today}/"
        f"{uuid.uuid4()}.json"
    )

    print(
        f"Writing {len(trusted_records)} records "
        f"to s3://{bucket}/{out_key}"
    )

    s3.put_object(
        Bucket=bucket,
        Key=out_key,
        Body=trusted_body.encode("utf-8"),
    )


def lambda_handler(event, context):
    """
    Lambda is triggered by S3 "ObjectCreated" events on the raw zone.
    For each new object, we transform and write to the trusted zone.
    """
    records = event.get("Records", [])
    print(f"lambda_handler: received {len(records)} S3 event records")

    for rec in records:
        bucket = rec["s3"]["bucket"]["name"]
        key = rec["s3"]["object"]["key"]
        process_s3_object(bucket, key)

    return {"status": "ok", "processed_files": len(records)}
