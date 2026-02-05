# SmartStream Quick Reference Card

## 🚀 Essential Commands

### Initial Deployment
```bash
terraform init
terraform plan
terraform apply
```

### Get Outputs
```bash
terraform output                           # All outputs
terraform output -raw data_lake_bucket_name  # Specific output
terraform output -json > outputs.json      # Save as JSON
```

### Start DMS Replication
```bash
aws dms start-replication-task \
  --replication-task-arn $(terraform output -raw dms_replication_task_arn) \
  --start-replication-task-type start-replication
```

### Check Pipeline Status
```bash
# DMS Task
aws dms describe-replication-tasks \
  --filters Name=replication-task-arn,Values=$(terraform output -raw dms_replication_task_arn) \
  | jq .ReplicationTasks[0].Status

# Kinesis Stream
aws kinesis describe-stream-summary \
  --stream-name $(terraform output -raw kinesis_stream_name)

# Lambda Logs (Transform)
aws logs tail /aws/lambda/$(terraform output -raw lambda_transform_function_name) --follow

# Lambda Logs (ML)
aws logs tail /aws/lambda/$(terraform output -raw lambda_ml_function_name) --follow

# S3 Data
aws s3 ls s3://$(terraform output -raw data_lake_bucket_name)/raw/ --recursive | tail -5
aws s3 ls s3://$(terraform output -raw data_lake_bucket_name)/trusted/ --recursive | tail -5
aws s3 ls s3://$(terraform output -raw data_lake_bucket_name)/trusted-analytics/ --recursive | tail -5
```

### Run Glue Crawlers
```bash
# Trusted zone
aws glue start-crawler --name $(terraform output -raw glue_trusted_crawler_name)

# Analytics zone
aws glue start-crawler --name $(terraform output -raw glue_analytics_crawler_name)

# Check status
aws glue get-crawler --name $(terraform output -raw glue_trusted_crawler_name) | jq .Crawler.State
```

### RDS Database
```bash
# Get credentials
aws secretsmanager get-secret-value \
  --secret-id $(terraform output -raw rds_secret_arn) \
  --query SecretString --output text | jq .

# Connect
psql -h $(terraform output -raw rds_endpoint | cut -d: -f1) -U dbadmin -d employees
```

### Athena Queries
```bash
# Start query
aws athena start-query-execution \
  --query-string "SELECT * FROM your_table LIMIT 10" \
  --query-execution-context Database=$(terraform output -raw glue_database_name) \
  --result-configuration OutputLocation=s3://$(terraform output -raw athena_results_bucket_name)/results/

# Get query results (replace QUERY_ID)
aws athena get-query-results --query-execution-id <QUERY_ID>
```

### Invoke ML Lambda
```bash
aws lambda invoke \
  --function-name $(terraform output -raw lambda_ml_function_name) \
  /tmp/response.json && cat /tmp/response.json | jq .
```

### CloudWatch
```bash
# View dashboard
echo "https://console.aws.amazon.com/cloudwatch/home?region=eu-north-1#dashboards:name=$(terraform output -raw cloudwatch_dashboard_name)"

# Recent alarms
aws cloudwatch describe-alarms --state-value ALARM
```

## 📊 Monitoring Queries

### DMS Metrics
```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/DMS \
  --metric-name FullLoadThroughputRowsSource \
  --dimensions Name=ReplicationTaskIdentifier,Value=smartstream-dev-cdc-task \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average
```

### Kinesis Metrics
```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/Kinesis \
  --metric-name IncomingRecords \
  --dimensions Name=StreamName,Value=$(terraform output -raw kinesis_stream_name) \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

### Lambda Metrics
```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=$(terraform output -raw lambda_transform_function_name) \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

## 🧹 Maintenance

### Stop DMS (to save costs)
```bash
aws dms stop-replication-task \
  --replication-task-arn $(terraform output -raw dms_replication_task_arn)
```

### Update Lambda Code
```bash
# After editing lambdas/transform/lambda_function.py or lambdas/ml/lambda_function.py
terraform apply -target=aws_lambda_function.transform
terraform apply -target=aws_lambda_function.ml_inference
```

### Update Configuration
```bash
# Edit terraform.tfvars
nano terraform.tfvars

# Apply changes
terraform plan
terraform apply
```

### View Costs
```bash
aws ce get-cost-and-usage \
  --time-period Start=2024-01-01,End=2024-01-31 \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --group-by Type=DIMENSION,Key=SERVICE
```

## 🔧 Troubleshooting

### DMS Connection Issues
```bash
aws dms test-connection \
  --replication-instance-arn $(terraform output -raw dms_replication_instance_arn) \
  --endpoint-arn $(terraform output -raw dms_source_endpoint_arn)
```

### Lambda Errors
```bash
aws logs filter-log-events \
  --log-group-name /aws/lambda/$(terraform output -raw lambda_transform_function_name) \
  --filter-pattern "ERROR"
```

### Glue Crawler Failures
```bash
aws glue get-crawler-metrics \
  --crawler-name-list $(terraform output -raw glue_trusted_crawler_name)
```

### S3 Bucket Contents
```bash
# Count objects in each zone
aws s3 ls s3://$(terraform output -raw data_lake_bucket_name)/raw/ --recursive | wc -l
aws s3 ls s3://$(terraform output -raw data_lake_bucket_name)/trusted/ --recursive | wc -l
aws s3 ls s3://$(terraform output -raw data_lake_bucket_name)/trusted-analytics/ --recursive | wc -l

# Check latest files
aws s3 ls s3://$(terraform output -raw data_lake_bucket_name)/raw/ --recursive | sort | tail -5
```

## 🗑️ Cleanup

### Full Destroy
```bash
# Stop DMS first
aws dms stop-replication-task \
  --replication-task-arn $(terraform output -raw dms_replication_task_arn)

# Empty buckets
aws s3 rm s3://$(terraform output -raw data_lake_bucket_name) --recursive
aws s3 rm s3://$(terraform output -raw athena_results_bucket_name) --recursive

# Destroy infrastructure
terraform destroy
```

## 📱 Console URLs

```bash
# Get all console URLs
terraform output quick_start_commands | jq .
```

- **CloudWatch Dashboard**: `https://console.aws.amazon.com/cloudwatch/home?region=eu-north-1#dashboards:name=smartstream-dev-pipeline-dashboard`
- **Athena Console**: `https://console.aws.amazon.com/athena/home?region=eu-north-1#/query-editor`
- **DMS Console**: `https://console.aws.amazon.com/dms/v2/home?region=eu-north-1#replicationTasks`
- **Kinesis Console**: `https://console.aws.amazon.com/kinesis/home?region=eu-north-1#/streams/details`
- **S3 Console**: `https://s3.console.aws.amazon.com/s3/buckets`
- **Lambda Console**: `https://console.aws.amazon.com/lambda/home?region=eu-north-1#/functions`
- **Glue Console**: `https://console.aws.amazon.com/glue/home?region=eu-north-1#catalog:tab=databases`

## 🔑 Key Resource Names

All resources follow the pattern: `{project_name}-{env}-{resource}-{account_id}`

Examples (assuming project=smartstream, env=dev):
- VPC: `smartstream-dev-vpc`
- RDS: `smartstream-dev-postgres`
- Kinesis: `smartstream-dev-cdc-stream`
- Firehose: `smartstream-dev-s3-delivery`
- Lambda Transform: `smartstream-dev-data-transform`
- Lambda ML: `smartstream-dev-ml-inference`
- Glue DB: `smartstream_dev_catalog`
- S3 Data Lake: `smartstream-dev-datalake-{account-id}`

## 📈 Performance Tuning

### Scale Kinesis
```hcl
# terraform.tfvars
kinesis_shards = 4  # Increase for higher throughput
```

### Adjust Firehose Buffering
```hcl
# Lower latency
firehose_buffer_interval_seconds = 60
firehose_buffer_size_mb = 1

# Higher throughput
firehose_buffer_interval_seconds = 300
firehose_buffer_size_mb = 128
```

### Increase Lambda Resources
```hcl
# lambda_transform.tf
timeout     = 600   # 10 minutes
memory_size = 1024  # 1 GB
```

## 💡 Tips

- Use `terraform state list` to see all managed resources
- Use `terraform show` to inspect current state
- Tag resources with `cost-center` for cost allocation
- Enable S3 versioning for data recovery
- Set up SNS email alerts for critical alarms
- Use VPC endpoints to reduce NAT Gateway costs
- Schedule DMS tasks during off-peak hours
- Monitor Kinesis iterator age for consumer lag
- Use Athena query federation for cross-source queries
- Consider Glue ETL jobs for complex transformations

---

**Pro Tip**: Save this file as a bookmark or print it for quick reference during operations!
