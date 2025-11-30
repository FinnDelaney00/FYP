# LambdaCode.py
# --------------
# AWS Lambda function that:
# - Listens for S3 ObjectCreated events on the raw zone
# - Reads raw DMS/Kinesis/Firehose JSON payloads
# - Normalises them into a clean "trusted" schema
# - Writes newline-delimited JSON files into a trusted S3 prefix
#   partitioned by ingest_date

import json     
import uuid    
from datetime import datetime, timezone

import boto3  

# Create a reusable S3 client outside the handler so it can be reused across Lambda invocations (improves performance)
s3 = boto3.client("s3")

# where to write trusted data within the bucket
TRUSTED_PREFIX = "data/trusted/"


def parse_raw_body(body: str):
    """
    Parse the DMS/Firehose file body into a list of JSON objects.
    """
    # Remove leading/trailing whitespace so we don't parse empty space
    body = body.strip()
    # If the body is empty return an empty list
    if not body:
        return []

    # This will hold each decoded JSON object
    records = []
    decoder = json.JSONDecoder()
    idx = 0
    length = len(body)

    while idx < length:
        while idx < length and body[idx].isspace():
            idx += 1
        if idx >= length:
            break

        try:
            # Attempt to decode a JSON object starting at position idx
            obj, end = decoder.raw_decode(body, idx)
        except json.JSONDecodeError as e:
            print(f"Failed to decode JSON chunk at pos {idx}: {e}")
            break

        # Append the successfully decoded object to list
        records.append(obj)
        # Move idx to the end of the just-decoded object to look for the next one
        idx = end

    # Log how many JSON objects we decoded and the input size
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
    # Extract the metadata dictionary, or {} if not present
    metadata = raw_record.get("metadata", {})
    if metadata.get("record-type") != "data":
        return None

    # Extract the row data 
    data = raw_record.get("data", {})
    # Operation type (insert, update, delete)
    op_type = metadata.get("operation")
    # Original source timestamp from DMS
    src_ts = metadata.get("timestamp")

    trusted = {
        # Business fields mapped from the raw data
        "id": data.get("id"),
        "education": data.get("education"),
        "joining_year": data.get("joiningyear"),
        "city": data.get("city"),
        "payment_tier": data.get("paymenttier"),
        "age": data.get("age"),
        "gender": data.get("gender"),
        # Normalise "everbenched" into a boolean: True if string "yes" (case-insensitive)
        "ever_benched": str(data.get("everbenched", "")).lower() == "yes",
        "experience_years": data.get("experienceincurrentdomain"),
        "leave_or_not": data.get("leaveornot"),

        # new metadata fields for trusted record
        "op_type": op_type,                         # insert/update/delete
        "source_timestamp": src_ts,                 # when the change happened in source
        "ingest_timestamp": datetime.now(timezone.utc).isoformat(),  # when Lambda processed it
        "schema_name": metadata.get("schema-name"), # source DB schema
        "table_name": metadata.get("table-name"),   # source table name
        "transaction_id": metadata.get("transaction-id"),  # source transaction ID
    }

    # Return the cleaned, trusted record
    return trusted


def process_s3_object(bucket: str, key: str):
    """
    Read a raw S3 object, transform its contents, and write a trusted file.
    """
    # Log which S3 object is being processed
    print(f"Processing s3://{bucket}/{key}")

    # Retrieve the object from S3 using the bucket and key
    obj = s3.get_object(Bucket=bucket, Key=key)
    body_bytes = obj["Body"].read()
    print(f"Raw object size (bytes): {len(body_bytes)}")

    # Decode the bytes into a UTF-8 string
    body = body_bytes.decode("utf-8")

    # Parse the raw string into a list of JSON records
    raw_records = parse_raw_body(body)
    print(f"Parsed {len(raw_records)} raw records")

    # List to hold successfully transformed trusted records
    trusted_records = []
    for raw in raw_records:
        # Transform the raw record into the trusted schema
        trusted = transform_record(raw)
        if trusted is not None:
            trusted_records.append(trusted)
            
    if not trusted_records:
        print("No trusted records produced from file; skipping write.")
        return

    # Serialise each trusted record as JSON and join them with newlines
    trusted_body = "\n".join(json.dumps(r) for r in trusted_records)

    # Generate an ingest_date partition based on current UTC date (YYYY-MM-DD)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    # data/trusted/ingest_date=YYYY-MM-DD/<UUID>.json
    out_key = (
        f"{TRUSTED_PREFIX}"
        f"ingest_date={today}/"
        f"{uuid.uuid4()}.json"
    )

    # Log the destination and how many records we will write
    print(
        f"Writing {len(trusted_records)} records "
        f"to s3://{bucket}/{out_key}"
    )

    # Put the trusted object into the same bucket but under the trusted prefix
    s3.put_object(
        Bucket=bucket,                     
        Key=out_key,                      
        Body=trusted_body.encode("utf-8") 
    )


def lambda_handler(event, context):
    """
    Lambda is triggered by S3 "ObjectCreated" events on the raw zone.
    For each new object, we transform and write to the trusted zone.
    """
    # Extract the list of S3 event records from the event
    records = event.get("Records", [])
    # Log how many S3 event records were received
    print(f"lambda_handler: received {len(records)} S3 event records")

    # Loop over each S3 event record
    for rec in records:
        bucket = rec["s3"]["bucket"]["name"]
        key = rec["s3"]["object"]["key"]
        process_s3_object(bucket, key)

    return {"status": "ok", "processed_files": len(records)}
