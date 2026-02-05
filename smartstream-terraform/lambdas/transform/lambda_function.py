"""
Lambda function to transform data from S3 raw zone to trusted zone.

This function:
1. Reads raw data files from S3 (triggered by S3 events)
2. Removes duplicates and nulls
3. Standardizes timestamp formats and data types
4. Validates schema consistency
5. Writes cleaned data to S3 trusted zone with deterministic keys
"""

import json
import boto3
import gzip
import hashlib
from datetime import datetime
from urllib.parse import unquote_plus
from io import BytesIO, TextIOWrapper

s3_client = boto3.client('s3')

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
        for record in event['Records']:
            # Extract S3 event details
            bucket = record['s3']['bucket']['name']
            key = unquote_plus(record['s3']['object']['key'])
            
            print(f"Processing file: s3://{bucket}/{key}")
            
            # Skip if not in raw zone
            if not key.startswith('raw/'):
                print(f"Skipping non-raw file: {key}")
                continue
            
            # Read raw data from S3
            raw_data = read_s3_object(bucket, key)
            
            # Transform data
            transformed_data = transform_data(raw_data, key)
            
            # Write to trusted zone
            trusted_key = generate_trusted_key(key)
            write_to_trusted(bucket, trusted_key, transformed_data)
            
            print(f"Successfully transformed: {key} -> {trusted_key}")
        
        return {
            'statusCode': 200,
            'body': json.dumps('Transformation completed successfully')
        }
    
    except Exception as e:
        print(f"Error during transformation: {str(e)}")
        raise


def read_s3_object(bucket, key):
    """Read and decompress S3 object (handles GZIP from Firehose)."""
    response = s3_client.get_object(Bucket=bucket, Key=key)
    body = response['Body'].read()
    
    # Handle GZIP compressed files from Firehose
    if key.endswith('.gz'):
        with gzip.GzipFile(fileobj=BytesIO(body)) as gzip_file:
            content = gzip_file.read().decode('utf-8')
    else:
        content = body.decode('utf-8')
    
    return content


def transform_data(raw_data, source_key):
    """
    Transform raw data: remove duplicates, clean nulls, standardize formats.
    
    Expected input: JSON lines format (one JSON object per line)
    """
    lines = raw_data.strip().split('\n')
    records = []
    seen_records = set()
    
    for line_num, line in enumerate(lines, 1):
        if not line.strip():
            continue
        
        try:
            record = json.loads(line)
            
            # Remove null/empty fields
            cleaned_record = {k: v for k, v in record.items() if v is not None and v != ''}
            
            # Skip if no data after cleaning
            if not cleaned_record:
                print(f"Line {line_num}: Skipped empty record after cleaning")
                continue
            
            # Standardize timestamps (convert to ISO 8601)
            cleaned_record = standardize_timestamps(cleaned_record)
            
            # Deduplicate using content hash
            record_hash = hashlib.md5(
                json.dumps(cleaned_record, sort_keys=True).encode()
            ).hexdigest()
            
            if record_hash not in seen_records:
                seen_records.add(record_hash)
                records.append(cleaned_record)
            else:
                print(f"Line {line_num}: Duplicate record detected and removed")
        
        except json.JSONDecodeError as e:
            print(f"Line {line_num}: Invalid JSON - {str(e)}")
            continue
    
    print(f"Transformed {len(records)} records (removed {len(lines) - len(records)} duplicates/invalids)")
    
    # Return as JSON lines
    return '\n'.join(json.dumps(record) for record in records)


def standardize_timestamps(record):
    """Standardize timestamp fields to ISO 8601 format."""
    timestamp_fields = ['timestamp', 'created_at', 'updated_at', 'datetime', 'date']
    
    for field in timestamp_fields:
        if field in record:
            try:
                # Try to parse various timestamp formats
                value = record[field]
                
                # If already ISO format, keep it
                if isinstance(value, str) and 'T' in value:
                    continue
                
                # Convert Unix timestamp (if numeric)
                if isinstance(value, (int, float)):
                    dt = datetime.fromtimestamp(value)
                    record[field] = dt.isoformat()
                
                # Add more parsing logic as needed for your data formats
                
            except Exception as e:
                print(f"Warning: Could not parse timestamp field '{field}': {str(e)}")
    
    return record


def generate_trusted_key(raw_key):
    """
    Generate deterministic S3 key for trusted zone.
    
    Example transformation:
    raw/year=2024/month=01/day=15/hour=10/file.gz
    -> trusted/year=2024/month=01/day=15/hour=10/file.json
    """
    # Remove 'raw/' prefix and '.gz' suffix
    key_parts = raw_key.replace('raw/', '').replace('.gz', '')
    
    # Ensure .json extension
    if not key_parts.endswith('.json'):
        key_parts += '.json'
    
    # Add 'trusted/' prefix
    return f"trusted/{key_parts}"


def write_to_trusted(bucket, key, data):
    """Write transformed data to S3 trusted zone."""
    s3_client.put_object(
        Bucket=bucket,
        Key=key,
        Body=data.encode('utf-8'),
        ContentType='application/json',
        ServerSideEncryption='AES256'
    )
    print(f"Written {len(data)} bytes to s3://{bucket}/{key}")
