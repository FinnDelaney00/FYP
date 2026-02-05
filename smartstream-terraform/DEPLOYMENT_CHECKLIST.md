# SmartStream Deployment Checklist

Use this checklist to ensure a smooth deployment of the SmartStream data pipeline.

## Pre-Deployment

- [ ] AWS CLI installed and configured
  ```bash
  aws configure
  aws sts get-caller-identity  # Verify credentials
  ```

- [ ] Terraform installed (>= 1.5.0)
  ```bash
  terraform version
  ```

- [ ] Reviewed and customized `terraform.tfvars`
  ```bash
  cp terraform.tfvars.example terraform.tfvars
  # Edit terraform.tfvars with your settings
  ```

- [ ] Verified AWS service quotas in target region (eu-north-1)
  - VPC: 1 required
  - RDS instances: 1 required
  - DMS replication instances: 1 required
  - Kinesis shards: 2+ required
  - Lambda concurrent executions: Check current usage

- [ ] Estimated monthly costs (~$85 for default configuration)

## Deployment

- [ ] Initialize Terraform
  ```bash
  terraform init
  ```

- [ ] Validate configuration
  ```bash
  terraform validate
  ```

- [ ] Review execution plan
  ```bash
  terraform plan -out=tfplan
  ```

- [ ] Apply infrastructure (takes 15-20 minutes)
  ```bash
  terraform apply tfplan
  ```

- [ ] Save outputs to file for reference
  ```bash
  terraform output > deployment-outputs.txt
  ```

## Post-Deployment Configuration

### Database Setup

- [ ] Retrieve RDS credentials from Secrets Manager
  ```bash
  aws secretsmanager get-secret-value \
    --secret-id $(terraform output -raw rds_secret_arn) \
    --query SecretString --output text | jq .
  ```

- [ ] Connect to RDS PostgreSQL
  ```bash
  psql -h <RDS_ENDPOINT> -U dbadmin -d employees
  ```

- [ ] Create sample tables and data (see README.md)

- [ ] Verify logical replication is enabled
  ```sql
  SHOW rds.logical_replication;  -- Should return 'on'
  ```

### DMS Configuration

- [ ] Verify DMS endpoints are healthy
  ```bash
  aws dms test-connection \
    --replication-instance-arn $(terraform output -raw dms_replication_instance_arn) \
    --endpoint-arn $(terraform output -raw dms_source_endpoint_arn)
  ```

- [ ] Start DMS replication task
  ```bash
  aws dms start-replication-task \
    --replication-task-arn $(terraform output -raw dms_replication_task_arn) \
    --start-replication-task-type start-replication
  ```

- [ ] Monitor DMS task status
  ```bash
  aws dms describe-replication-tasks \
    --filters Name=replication-task-arn,Values=$(terraform output -raw dms_replication_task_arn)
  ```

### Data Flow Verification

- [ ] Verify data in Kinesis stream
  ```bash
  aws kinesis describe-stream \
    --stream-name $(terraform output -raw kinesis_stream_name)
  ```

- [ ] Check S3 raw zone for incoming data (wait 1-2 minutes after DMS start)
  ```bash
  aws s3 ls s3://$(terraform output -raw data_lake_bucket_name)/raw/ --recursive | head -10
  ```

- [ ] Verify Lambda transform is triggered
  ```bash
  aws logs tail /aws/lambda/$(terraform output -raw lambda_transform_function_name) --follow
  ```

- [ ] Check S3 trusted zone for transformed data
  ```bash
  aws s3 ls s3://$(terraform output -raw data_lake_bucket_name)/trusted/ --recursive | head -10
  ```

### Glue Catalog Setup

- [ ] Run Glue crawler for trusted zone
  ```bash
  aws glue start-crawler --name $(terraform output -raw glue_trusted_crawler_name)
  ```

- [ ] Wait for crawler completion (2-5 minutes)
  ```bash
  aws glue get-crawler --name $(terraform output -raw glue_trusted_crawler_name) \
    | jq .Crawler.State
  ```

- [ ] Verify tables created in Glue catalog
  ```bash
  aws glue get-tables \
    --database-name $(terraform output -raw glue_database_name) \
    | jq .TableList[].Name
  ```

### Athena Configuration

- [ ] Open Athena console
  ```bash
  # Use the URL from terraform output quick_start_commands
  ```

- [ ] Run test query
  ```sql
  SELECT * FROM <table_name> LIMIT 10;
  ```

- [ ] Verify query results in S3
  ```bash
  aws s3 ls s3://$(terraform output -raw athena_results_bucket_name)/results/ --recursive | tail -5
  ```

### ML Pipeline Setup

- [ ] Verify ML Lambda is scheduled
  ```bash
  aws events list-rules --name-prefix smartstream-dev-ml
  ```

- [ ] Manually invoke ML Lambda for testing
  ```bash
  aws lambda invoke \
    --function-name $(terraform output -raw lambda_ml_function_name) \
    /tmp/response.json && cat /tmp/response.json
  ```

- [ ] Check ML outputs in analytics zone
  ```bash
  aws s3 ls s3://$(terraform output -raw data_lake_bucket_name)/trusted-analytics/ --recursive
  ```

- [ ] Run analytics crawler
  ```bash
  aws glue start-crawler --name $(terraform output -raw glue_analytics_crawler_name)
  ```

### Monitoring Setup

- [ ] View CloudWatch Dashboard
  ```bash
  # Use the URL from terraform output quick_start_commands
  ```

- [ ] Configure SNS topic email subscription (optional)
  ```bash
  aws sns subscribe \
    --topic-arn $(terraform output -raw sns_alerts_topic_arn) \
    --protocol email \
    --notification-endpoint your-email@example.com
  
  # Check email and confirm subscription
  ```

- [ ] Test alarms by triggering errors (optional)

### CDC Testing

- [ ] Insert test record in RDS
  ```sql
  INSERT INTO employees (first_name, last_name, email, department, salary, hire_date)
  VALUES ('Test', 'User', 'test@example.com', 'QA', 75000, CURRENT_DATE);
  ```

- [ ] Wait 2-3 minutes and verify record appears in:
  - [ ] Kinesis stream metrics (CloudWatch)
  - [ ] S3 raw zone (new file)
  - [ ] S3 trusted zone (after Lambda transform)

- [ ] Update test record
  ```sql
  UPDATE employees SET salary = 80000 WHERE email = 'test@example.com';
  ```

- [ ] Verify update captured in CDC pipeline

- [ ] Delete test record
  ```sql
  DELETE FROM employees WHERE email = 'test@example.com';
  ```

- [ ] Verify delete operation captured

## Documentation

- [ ] Document RDS endpoint and credentials location
- [ ] Document S3 bucket names and prefixes
- [ ] Document Glue database and table names
- [ ] Document Athena workgroup name
- [ ] Document CloudWatch dashboard URL
- [ ] Save Terraform outputs for team reference
- [ ] Document any customizations made
- [ ] Create runbook for common operations

## Cost Monitoring

- [ ] Set up AWS Budget alert
  ```bash
  # Create a budget via AWS Console or CLI
  ```

- [ ] Review AWS Cost Explorer for initial costs

- [ ] Verify NAT Gateway traffic (consider VPC endpoints for S3)

- [ ] Check Kinesis shard hours usage

- [ ] Monitor Lambda invocation costs

## Security Review

- [ ] Verify S3 buckets have public access blocked
- [ ] Confirm RDS is not publicly accessible
- [ ] Verify Secrets Manager rotation is configured (optional)
- [ ] Review IAM policies for least-privilege compliance
- [ ] Check security groups for overly permissive rules
- [ ] Enable CloudTrail for audit logging (if not already enabled)
- [ ] Review VPC Flow Logs configuration (optional)

## Cleanup Checklist (When Decommissioning)

- [ ] Stop DMS replication task
  ```bash
  aws dms stop-replication-task \
    --replication-task-arn $(terraform output -raw dms_replication_task_arn)
  ```

- [ ] Export any critical data from S3
  ```bash
  aws s3 sync s3://$(terraform output -raw data_lake_bucket_name) ./backup/
  ```

- [ ] Empty S3 buckets
  ```bash
  aws s3 rm s3://$(terraform output -raw data_lake_bucket_name) --recursive
  aws s3 rm s3://$(terraform output -raw athena_results_bucket_name) --recursive
  ```

- [ ] Run Terraform destroy
  ```bash
  terraform destroy
  ```

- [ ] Verify all resources deleted in AWS Console

- [ ] Remove Terraform state files from local machine (if not using remote state)

## Troubleshooting Reference

| Issue | Solution |
|-------|----------|
| DMS task won't start | Check RDS logical replication, security groups, credentials |
| Lambda not triggered | Verify S3 event notification, Lambda permissions |
| Glue crawler finds no tables | Check S3 data exists, correct format, crawler permissions |
| High Kinesis iterator age | Increase Firehose buffer, add consumers, reduce retention |
| Athena query fails | Verify Glue table schema, check S3 data format |
| High costs | Check NAT Gateway usage, Kinesis shard hours, data retention |

## Notes

- [ ] Record deployment date: _______________
- [ ] Record deployed by: _______________
- [ ] Record AWS account ID: _______________
- [ ] Record deployment region: eu-north-1
- [ ] Record any deployment issues: _______________

---

**Deployment Status**: ☐ Not Started | ☐ In Progress | ☐ Completed | ☐ Failed

**Sign-off**: _______________ Date: _______________
