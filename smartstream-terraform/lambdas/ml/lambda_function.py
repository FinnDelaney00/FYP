"""
Lambda function for ML inference on trusted data.

This is a PLACEHOLDER implementation. Replace the inference logic
with your actual ML model (e.g., SageMaker endpoint, scikit-learn, TensorFlow, etc.).

This function:
1. Reads data from S3 trusted zone
2. Runs ML inference (placeholder logic)
3. Writes predictions/analytics to S3 trusted-analytics zone
"""

import json
import boto3
from datetime import datetime
import os

s3_client = boto3.client('s3')

# Environment variables (set by Terraform)
DATA_LAKE_BUCKET = os.environ['DATA_LAKE_BUCKET']
TRUSTED_PREFIX = os.environ['TRUSTED_PREFIX']
ANALYTICS_PREFIX = os.environ['ANALYTICS_PREFIX']


def lambda_handler(event, context):
    """
    Main Lambda handler triggered by EventBridge schedule.
    
    This runs periodically to perform ML inference on recent trusted data.
    """
    try:
        print(f"Starting ML inference run at {datetime.utcnow().isoformat()}")
        
        # List recent trusted zone files
        trusted_files = list_recent_trusted_files()
        
        if not trusted_files:
            print("No recent trusted files found for inference")
            return {
                'statusCode': 200,
                'body': json.dumps('No data to process')
            }
        
        print(f"Found {len(trusted_files)} files for inference")
        
        # Process each file
        results = []
        for file_key in trusted_files[:10]:  # Limit to 10 files per run
            result = process_file(file_key)
            results.append(result)
        
        # Write aggregated results
        output_key = generate_analytics_key()
        write_analytics_results(results, output_key)
        
        print(f"ML inference completed successfully. Results written to {output_key}")
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'ML inference completed',
                'files_processed': len(results),
                'output_key': output_key
            })
        }
    
    except Exception as e:
        print(f"Error during ML inference: {str(e)}")
        raise


def list_recent_trusted_files():
    """List recent files from trusted zone (last 24 hours)."""
    # Calculate yesterday's date partition
    yesterday = datetime.utcnow()
    prefix = f"{TRUSTED_PREFIX}year={yesterday.year}/month={yesterday.month:02d}/day={yesterday.day:02d}/"
    
    try:
        response = s3_client.list_objects_v2(
            Bucket=DATA_LAKE_BUCKET,
            Prefix=prefix,
            MaxKeys=100
        )
        
        if 'Contents' not in response:
            return []
        
        return [obj['Key'] for obj in response['Contents'] if obj['Key'].endswith('.json')]
    
    except Exception as e:
        print(f"Error listing trusted files: {str(e)}")
        return []


def process_file(file_key):
    """
    Process a single file and run ML inference.
    
    PLACEHOLDER: Replace this with your actual ML model logic.
    """
    try:
        # Read data from S3
        response = s3_client.get_object(Bucket=DATA_LAKE_BUCKET, Key=file_key)
        content = response['Body'].read().decode('utf-8')
        
        # Parse JSON lines
        records = [json.loads(line) for line in content.strip().split('\n') if line.strip()]
        
        # PLACEHOLDER ML INFERENCE LOGIC
        # Example: Simple aggregation/scoring
        predictions = []
        for record in records:
            prediction = {
                'record_id': record.get('id', 'unknown'),
                'timestamp': datetime.utcnow().isoformat(),
                'score': calculate_placeholder_score(record),
                'category': classify_placeholder(record),
                'confidence': 0.85,  # Placeholder confidence
                'source_file': file_key
            }
            predictions.append(prediction)
        
        print(f"Processed {len(predictions)} records from {file_key}")
        
        return {
            'file': file_key,
            'records_processed': len(predictions),
            'predictions': predictions
        }
    
    except Exception as e:
        print(f"Error processing file {file_key}: {str(e)}")
        return {
            'file': file_key,
            'error': str(e)
        }


def calculate_placeholder_score(record):
    """
    PLACEHOLDER: Calculate a simple score based on record data.
    
    Replace with your actual ML model scoring logic.
    """
    # Example: Score based on some numeric field
    if 'salary' in record:
        try:
            salary = float(record['salary'])
            # Simple normalization (placeholder logic)
            return min(salary / 100000, 1.0)
        except (ValueError, TypeError):
            pass
    
    return 0.5  # Default score


def classify_placeholder(record):
    """
    PLACEHOLDER: Classify record into categories.
    
    Replace with your actual ML model classification logic.
    """
    # Example: Simple rule-based classification
    if 'department' in record:
        dept = record['department'].lower()
        if 'engineering' in dept or 'tech' in dept:
            return 'technical'
        elif 'sales' in dept or 'marketing' in dept:
            return 'business'
        elif 'hr' in dept or 'admin' in dept:
            return 'operations'
    
    return 'other'


def generate_analytics_key():
    """Generate S3 key for analytics output with timestamp partitioning."""
    now = datetime.utcnow()
    return (
        f"{ANALYTICS_PREFIX}"
        f"year={now.year}/month={now.month:02d}/day={now.day:02d}/"
        f"ml_inference_{now.strftime('%Y%m%d_%H%M%S')}.json"
    )


def write_analytics_results(results, output_key):
    """Write ML inference results to S3 analytics zone."""
    # Flatten all predictions into a single list
    all_predictions = []
    for result in results:
        if 'predictions' in result:
            all_predictions.extend(result['predictions'])
    
    # Add metadata
    output_data = {
        'metadata': {
            'inference_timestamp': datetime.utcnow().isoformat(),
            'total_predictions': len(all_predictions),
            'files_processed': len(results)
        },
        'predictions': all_predictions
    }
    
    # Write to S3
    s3_client.put_object(
        Bucket=DATA_LAKE_BUCKET,
        Key=output_key,
        Body=json.dumps(output_data, indent=2).encode('utf-8'),
        ContentType='application/json',
        ServerSideEncryption='AES256'
    )
    
    print(f"Written {len(all_predictions)} predictions to s3://{DATA_LAKE_BUCKET}/{output_key}")
