# SmartStream Terraform Quick Reference

## Core Terraform Commands

```bash
cd smartstream-terraform
terraform init
terraform fmt -check -recursive
terraform validate
terraform output
```

## Workspace + Mode Selection

### Legacy bootstrap mode

```bash
terraform workspace select newaccount || terraform workspace new newaccount
terraform plan -var 'enable_tenant_prefix=false' -var 'create_shared_iam=true'
terraform apply -var 'enable_tenant_prefix=false' -var 'create_shared_iam=true'
```

### Tenant mode (example: acme/dev)

```bash
terraform workspace select acme || terraform workspace new acme
terraform plan \
  -var 'enable_tenant_prefix=true' \
  -var 'company_name=acme' \
  -var 'environment=dev' \
  -var 'create_shared_iam=false'
terraform apply \
  -var 'enable_tenant_prefix=true' \
  -var 'company_name=acme' \
  -var 'environment=dev' \
  -var 'create_shared_iam=false'
```

## Key Outputs

```bash
terraform output -raw live_api_base_url
terraform output -raw data_lake_bucket_name
terraform output -raw dms_replication_task_arn
terraform output -raw dms_finance_replication_task_arn
terraform output -raw lambda_transform_function_name
terraform output -raw lambda_ml_function_name
terraform output -raw lambda_anomaly_function_name
terraform output -raw lambda_live_api_function_name
terraform output -raw cloudwatch_dashboard_name
```

## Pipeline Checks

```bash
# DMS tasks
aws dms describe-replication-tasks --filters Name=replication-task-arn,Values=$(terraform output -raw dms_replication_task_arn)
aws dms describe-replication-tasks --filters Name=replication-task-arn,Values=$(terraform output -raw dms_finance_replication_task_arn)

# Kinesis
aws kinesis describe-stream-summary --stream-name $(terraform output -raw kinesis_stream_name)

# S3 zones
aws s3 ls s3://$(terraform output -raw data_lake_bucket_name)/raw/ --recursive | tail -10
aws s3 ls s3://$(terraform output -raw data_lake_bucket_name)/trusted/ --recursive | tail -10
aws s3 ls s3://$(terraform output -raw data_lake_bucket_name)/trusted-analytics/ --recursive | tail -10
```

## Lambda Logs

```bash
aws logs tail /aws/lambda/$(terraform output -raw lambda_transform_function_name) --follow
aws logs tail /aws/lambda/$(terraform output -raw lambda_ml_function_name) --follow
aws logs tail /aws/lambda/$(terraform output -raw lambda_anomaly_function_name) --follow
aws logs tail /aws/lambda/$(terraform output -raw lambda_live_api_function_name) --follow
```

## Glue + Athena

```bash
aws glue start-crawler --name $(terraform output -raw glue_trusted_crawler_name)
aws glue start-crawler --name $(terraform output -raw glue_analytics_crawler_name)
aws glue get-tables --database-name $(terraform output -raw glue_database_name)
```

## API Smoke Tests

```bash
BASE_URL=$(terraform output -raw live_api_base_url)

# Public auth endpoints
curl -X POST "$BASE_URL/auth/login" -H "Content-Type: application/json" -d '{"email":"user@example.com","password":"Password123"}'

# Protected example (replace TOKEN)
curl "$BASE_URL/dashboard" -H "Authorization: Bearer TOKEN"
```

## Frontend Deploy

```bash
cd ../frontend
npm ci
npm run build
aws s3 sync dist s3://$(cd ../smartstream-terraform && terraform output -raw web_bucket_name) --delete
```

CloudFront invalidation command is available via:

```bash
cd ../smartstream-terraform
terraform output frontend_deploy_commands
```

## Tests

```bash
# from repo root
python -m unittest discover -s tests -v
```

## Cleanup

```bash
aws dms stop-replication-task --replication-task-arn $(terraform output -raw dms_replication_task_arn)
aws dms stop-replication-task --replication-task-arn $(terraform output -raw dms_finance_replication_task_arn)
aws s3 rm s3://$(terraform output -raw data_lake_bucket_name) --recursive
aws s3 rm s3://$(terraform output -raw athena_results_bucket_name) --recursive
terraform destroy
```
