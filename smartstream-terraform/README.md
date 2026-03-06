# SmartStream Data Platform - Terraform Infrastructure

A complete, production-ready AWS data pipeline built with Terraform, featuring Change Data Capture (CDC), real-time streaming, data transformation, cataloging, and ML inference capabilities.

## Deployment Modes (Legacy + Tenant)

### Legacy deployment (default-safe)

- Workspace: `newaccount` (current legacy workspace)
- Required vars:
  - `enable_tenant_prefix = false`
  - `create_shared_iam = true`
- Naming behavior:
  - Uses `legacy_name_prefix` (default `smartstream-dev`)
  - Preserves existing legacy resource names by default
- IAM behavior:
  - Shared IAM roles/policies are created and managed only here

### Tenant deployment (multi-company)

- Workspace: normalized company name (for example `acme`)
- Required vars:
  - `enable_tenant_prefix = true`
  - `company_name = "<company>"`
  - `environment = "dev|test|prod"`
  - `create_shared_iam = false`
- Naming behavior:
  - Uses `${company_name}-${environment}` (or `name_prefix_override`)
  - S3 buckets use tenant-safe prefix with account suffix for uniqueness
- IAM behavior:
  - No IAM roles/policies are created in tenant workspaces
  - Existing shared IAM is discovered/reused

### Critical safety warning

Applying tenant mode against legacy state/workspace can trigger replacements. Guardrails in Terraform and Jenkins prevent this by enforcing:

- tenant workspace must match normalized company name
- tenant mode requires `create_shared_iam=false`
- shared IAM creation is restricted to legacy workspace

### Shared IAM bootstrap flow

1. Select legacy workspace (`newaccount`).
2. Run legacy apply with `create_shared_iam=true` to create shared IAM once.
3. For each company, switch to company workspace and deploy tenant mode with `create_shared_iam=false`.
4. Never create IAM in tenant workspaces.

### Backend/workspace isolation guidance

- Current repo uses local backend with workspace state isolation under `terraform.tfstate.d/`.
- If moving to S3 backend, use workspace-aware keys. Example pattern:

```hcl
terraform {
  backend "s3" {
    bucket               = "your-tf-state-bucket"
    key                  = "smartstream/terraform.tfstate"
    workspace_key_prefix = "smartstream/workspaces"
    region               = "eu-north-1"
    encrypt              = true
  }
}
```

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SMARTSTREAM DATA PIPELINE                        │
└─────────────────────────────────────────────────────────────────────────┘

 ┌──────────────┐
 │  RDS (PG)    │  Source Database
 │  PostgreSQL  │  ├─ Employee Data
 └──────┬───────┘  └─ Credentials in Secrets Manager
        │
        │ CDC (Change Data Capture)
        ↓
 ┌──────────────┐
 │     DMS      │  Database Migration Service
 │  Replication │  ├─ Full Load + CDC
 └──────┬───────┘  └─ JSON-formatted output
        │
        │ Stream to Kinesis
        ↓
 ┌──────────────┐
 │   Kinesis    │  Streaming Backbone
 │ Data Stream  │  ├─ 2 shards (configurable)
 └──────┬───────┘  └─ 24h retention
        │
        │ Consume & Deliver
        ↓
 ┌──────────────┐
 │  Firehose    │  S3 Delivery
 │   Delivery   │  ├─ GZIP compression
 └──────┬───────┘  └─ Low-latency buffering
        │
        │ Write to S3 Raw Zone
        ↓
 ┌──────────────────────────────────────────────────────────┐
 │                     S3 DATA LAKE                          │
 │  ┌──────────┐   ┌─────────────┐   ┌──────────────────┐  │
 │  │   RAW/   │→→→│  TRUSTED/   │→→→│ TRUSTED-ANALYTICS│  │
 │  └────┬─────┘   └──────┬──────┘   └────────┬─────────┘  │
 └───────│────────────────│──────────────────│─────────────┘
         │                │                   │
         │ S3 Event       │ EventBridge      │
         ↓                ↓                   ↓
   ┌──────────┐    ┌──────────┐       ┌──────────┐
   │ Lambda   │    │  Glue    │       │  Glue    │
   │Transform │    │ Crawler  │       │ Crawler  │
   └──────────┘    └──────────┘       └──────────┘
        │                │                   │
        │ Cleanse &      │ Catalog          │ Catalog
        │ Validate       ↓                   ↓
        │          ┌─────────────────────────────┐
        │          │   GLUE DATA CATALOG         │
        └──────→   │   (Schema Registry)         │
                   └──────────┬──────────────────┘
                              │
                              │ Query
                              ↓
                        ┌──────────┐
                        │  Athena  │  SQL Analytics
                        │ Workgroup│  └─ Serverless queries
                        └──────────┘

   ┌──────────────────────────────────────────────┐
   │         ML INFERENCE LAYER                    │
   │  ┌──────────┐           ┌──────────────┐     │
   │  │EventBridge│──────→   │   Lambda     │     │
   │  │ Schedule  │  Hourly  │ ML Inference │     │
   │  └──────────┘           └──────┬───────┘     │
   │                                │              │
   │          Reads from TRUSTED/   │              │
   │          Writes to ANALYTICS/  ↓              │
   └──────────────────────────────────────────────┘
```

## 📋 Prerequisites

Before deploying this infrastructure, ensure you have:

1. **AWS Account** with appropriate permissions
2. **Terraform** >= 1.5.0 installed ([Download](https://www.terraform.io/downloads))
3. **AWS CLI** configured with credentials ([Setup Guide](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-configure.html))
4. **Sufficient AWS Service Quotas**:
   - VPC (1)
   - RDS instances (1)
   - DMS replication instances (1)
   - Kinesis shards (2+)
   - Lambda functions (2)
   - S3 buckets (2)

## 🚀 Quick Start

### 1. Clone and Navigate

```bash
cd smartstream-terraform
```

### 2. Initialize Terraform

```bash
terraform init
```

This downloads required providers (AWS, Archive, Random).

### 3. Review and Customize Variables

Edit `terraform.tfvars` (create it if it doesn't exist):

```hcl
# terraform.tfvars
project_name = "smartstream"
env          = "dev"
region       = "eu-north-1"

# Database Configuration
db_name     = "employees"
db_username = "dbadmin"
# db_password is auto-generated if not provided

# Kinesis Configuration
kinesis_shards = 2

# Firehose Configuration (low-latency defaults)
firehose_buffer_interval_seconds = 60  # 1 minute
firehose_buffer_size_mb          = 5   # 5 MB

# CloudWatch Logs
log_retention_days = 7

# RDS Configuration
rds_instance_class    = "db.t3.micro"
rds_allocated_storage = 20

# ML Inference Schedule
ml_schedule_expression = "rate(1 hour)"

# Glue Crawler Schedule
glue_crawler_schedule = "cron(0 2 * * ? *)"  # Daily at 2 AM UTC
```

### 4. Plan Infrastructure

```bash
terraform plan
```

Review the resources that will be created (~50+ resources).

### 5. Deploy Infrastructure

```bash
terraform apply
```

Type `yes` when prompted. **Deployment takes approximately 15-20 minutes**.

### 6. Retrieve Outputs

```bash
terraform output
```

Save important outputs like:
- RDS endpoint
- S3 bucket names
- Kinesis stream name
- Lambda function names
- Athena workgroup name

## 📊 Post-Deployment Steps

### 1. Populate Source Database

Connect to RDS and create sample data:

```bash
# Get RDS credentials
aws secretsmanager get-secret-value \
  --secret-id $(terraform output -raw rds_secret_arn) \
  --query SecretString --output text | jq .

# Connect to RDS (use endpoint from output)
psql -h <RDS_ENDPOINT> -U dbadmin -d employees

# Create sample table
CREATE TABLE employees (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(50),
    last_name VARCHAR(50),
    email VARCHAR(100),
    department VARCHAR(50),
    salary NUMERIC(10,2),
    hire_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

# Insert sample data
INSERT INTO employees (first_name, last_name, email, department, salary, hire_date)
VALUES
    ('John', 'Doe', 'john.doe@example.com', 'Engineering', 95000.00, '2022-01-15'),
    ('Jane', 'Smith', 'jane.smith@example.com', 'Marketing', 78000.00, '2022-03-20'),
    ('Bob', 'Johnson', 'bob.johnson@example.com', 'Sales', 82000.00, '2021-11-10');
```

### 2. Start DMS Replication Task

The DMS task is created but not auto-started. Start it manually:

```bash
aws dms start-replication-task \
  --replication-task-arn $(terraform output -raw dms_replication_task_arn) \
  --start-replication-task-type start-replication
```

Monitor the task:

```bash
aws dms describe-replication-tasks \
  --filters Name=replication-task-arn,Values=$(terraform output -raw dms_replication_task_arn)
```

### 3. Verify Data Flow

**Check Kinesis Stream:**
```bash
aws kinesis describe-stream \
  --stream-name $(terraform output -raw kinesis_stream_name)
```

**Check S3 Raw Zone:**
```bash
aws s3 ls s3://$(terraform output -raw data_lake_bucket_name)/raw/ --recursive
```

**Check S3 Trusted Zone (after Lambda transform):**
```bash
aws s3 ls s3://$(terraform output -raw data_lake_bucket_name)/trusted/ --recursive
```

### 4. Run Glue Crawlers

Catalog the data for Athena queries:

```bash
# Crawl trusted zone
aws glue start-crawler --name $(terraform output -raw glue_trusted_crawler_name)

# Crawl analytics zone
aws glue start-crawler --name $(terraform output -raw glue_analytics_crawler_name)

# Check crawler status
aws glue get-crawler --name $(terraform output -raw glue_trusted_crawler_name)
```

### 5. Query Data with Athena

Navigate to Athena console or use AWS CLI:

```bash
# List tables in Glue catalog
aws glue get-tables --database-name $(terraform output -raw glue_database_name)

# Run a query (replace table_name with actual table from Glue)
aws athena start-query-execution \
  --query-string "SELECT * FROM table_name LIMIT 10" \
  --query-execution-context Database=$(terraform output -raw glue_database_name) \
  --result-configuration OutputLocation=s3://$(terraform output -raw athena_results_bucket_name)/results/
```

### 6. Test CDC (Change Data Capture)

Make changes to the source database:

```sql
-- Insert new record
INSERT INTO employees (first_name, last_name, email, department, salary, hire_date)
VALUES ('Alice', 'Williams', 'alice.williams@example.com', 'HR', 70000.00, '2023-05-01');

-- Update existing record
UPDATE employees SET salary = 98000.00 WHERE id = 1;

-- Delete record
DELETE FROM employees WHERE id = 3;
```

DMS will capture these changes and stream them through the pipeline!

### 7. Monitor the Pipeline

**CloudWatch Dashboard:**
```bash
# Get dashboard URL
terraform output quick_start_commands
```

**Check Lambda Logs:**
```bash
# Transform Lambda
aws logs tail /aws/lambda/$(terraform output -raw lambda_transform_function_name) --follow

# ML Lambda
aws logs tail /aws/lambda/$(terraform output -raw lambda_ml_function_name) --follow
```

## 🔧 Customization Guide

### Scaling Kinesis

To handle higher throughput, increase shard count:

```hcl
# terraform.tfvars
kinesis_shards = 4  # Each shard: 1 MB/s in, 2 MB/s out
```

Then apply:
```bash
terraform apply
```

### Adjusting Lambda Memory/Timeout

Edit `lambda_transform.tf` or `lambda_ml.tf`:

```hcl
resource "aws_lambda_function" "transform" {
  # ...
  timeout     = 600  # 10 minutes
  memory_size = 1024 # 1 GB
}
```

### Changing ML Inference Schedule

```hcl
# terraform.tfvars
ml_schedule_expression = "rate(30 minutes)"  # Run every 30 minutes
# or
ml_schedule_expression = "cron(0 */6 * * ? *)"  # Every 6 hours
```

### Adding Custom Lambda Logic

Replace placeholder logic in:
- `lambdas/transform/lambda_function.py` - Data transformation
- `lambdas/ml/lambda_function.py` - ML inference

After changes:
```bash
terraform apply  # Re-zips and deploys Lambda code
```

## 📁 File Structure

```
smartstream-terraform/
├── versions.tf           # Terraform and provider versions
├── providers.tf          # Provider configurations
├── variables.tf          # Input variables
├── locals.tf             # Computed local values
├── outputs.tf            # Output values
├── networking.tf         # VPC, subnets, security groups
├── s3.tf                 # S3 buckets (data lake, Athena results)
├── secrets.tf            # Secrets Manager for RDS credentials
├── rds.tf                # PostgreSQL database
├── kinesis.tf            # Kinesis Data Stream
├── dms.tf                # DMS replication instance and tasks
├── firehose.tf           # Kinesis Firehose delivery stream
├── lambda_transform.tf   # Transform Lambda function
├── lambda_ml.tf          # ML inference Lambda function
├── glue.tf               # Glue Data Catalog and Crawlers
├── athena.tf             # Athena workgroup
├── iam.tf                # IAM roles and policies (least-privilege)
├── cloudwatch.tf         # CloudWatch monitoring and alarms
├── lambdas/
│   ├── transform/
│   │   └── lambda_function.py  # Transform handler
│   └── ml/
│       └── lambda_function.py  # ML inference handler
└── README.md             # This file
```

## 💰 Cost Estimation

**Monthly costs for default configuration (eu-north-1):**

| Service | Configuration | Estimated Cost |
|---------|--------------|----------------|
| RDS PostgreSQL | db.t3.micro, 20GB | ~$15 |
| DMS | dms.t3.micro | ~$13 |
| Kinesis Data Stream | 2 shards | ~$22 |
| Kinesis Firehose | 1 GB/day | ~$1 |
| Lambda | 100 invocations/day | ~$1 |
| S3 Storage | 10 GB | ~$0.25 |
| NAT Gateway | 1 instance | ~$32 |
| Glue Crawler | Daily runs | ~$0.44 |
| Athena | 1 GB scanned/day | ~$0.15 |
| **TOTAL** | | **~$85/month** |

**Cost Optimization Tips:**
- Use VPC endpoints to eliminate NAT Gateway charges (~$32/month savings)
- Reduce Kinesis retention period (24h → 1h)
- Use lifecycle policies to move old data to Glacier
- Stop DMS when not actively replicating

## 🔒 Security Features

- ✅ **Encryption at Rest**: S3 (SSE-S3), RDS (encrypted storage)
- ✅ **Encryption in Transit**: SSL/TLS for RDS, HTTPS for S3/Kinesis
- ✅ **Secrets Management**: RDS credentials in AWS Secrets Manager
- ✅ **Least-Privilege IAM**: Each service has minimal required permissions
- ✅ **Network Isolation**: Private subnets for RDS, DMS, Lambda
- ✅ **S3 Public Access Block**: Enabled on all buckets
- ✅ **VPC Security Groups**: Restrictive ingress/egress rules

## 🐛 Troubleshooting

### DMS Task Fails to Start

**Check:**
1. RDS is in "available" state
2. Logical replication is enabled (`rds.logical_replication = 1`)
3. Security groups allow DMS → RDS connectivity
4. Secrets Manager has correct credentials

**Solution:**
```bash
aws dms test-connection \
  --replication-instance-arn $(terraform output -raw dms_replication_instance_arn) \
  --endpoint-arn $(terraform output -raw dms_source_endpoint_arn)
```

### Lambda Transform Not Triggering

**Check:**
1. S3 event notification is configured
2. Lambda has permission to be invoked by S3
3. Files are being written to `/raw/` prefix

**Solution:**
```bash
aws lambda get-policy \
  --function-name $(terraform output -raw lambda_transform_function_name)
```

### Glue Crawler Finds No Tables

**Check:**
1. Data exists in S3 trusted zone
2. Data is in supported format (JSON, CSV, Parquet)
3. Crawler has S3 read permissions

**Solution:**
```bash
aws s3 ls s3://$(terraform output -raw data_lake_bucket_name)/trusted/ --recursive
```

### High Kinesis Iterator Age

**Symptom:** Firehose falling behind Kinesis stream

**Solution:**
- Increase Firehose buffering
- Reduce Kinesis retention period
- Add more Firehose delivery streams

## 🧹 Cleanup

To destroy all infrastructure:

```bash
# Stop DMS task first (optional, but cleaner)
aws dms stop-replication-task \
  --replication-task-arn $(terraform output -raw dms_replication_task_arn)

# Empty S3 buckets (required before destroy)
aws s3 rm s3://$(terraform output -raw data_lake_bucket_name) --recursive
aws s3 rm s3://$(terraform output -raw athena_results_bucket_name) --recursive

# Destroy infrastructure
terraform destroy
```

Type `yes` when prompted. **Destruction takes approximately 10-15 minutes**.

## 📚 Data Flow Summary

1. **Source**: RDS PostgreSQL contains employee data
2. **Ingestion**: DMS captures changes (full load + CDC) and streams to Kinesis
3. **Streaming**: Kinesis Data Stream acts as buffer/backbone
4. **Delivery**: Firehose reads from Kinesis, compresses, and writes to S3 `/raw/`
5. **Transformation**: Lambda triggers on S3 events, cleanses data, writes to `/trusted/`
6. **Cataloging**: Glue Crawlers discover schema and update Data Catalog
7. **Analytics**: Athena queries cataloged data using SQL
8. **ML**: Scheduled Lambda reads `/trusted/`, runs inference, writes to `/trusted-analytics/`

## 🎯 Next Steps

- [ ] Set up SNS email notifications for alerts
- [ ] Implement data quality checks in Transform Lambda
- [ ] Add actual ML model to ML Lambda
- [ ] Create Athena views for common queries
- [ ] Implement data retention policies
- [ ] Add CICD pipeline for Lambda deployments
- [ ] Enable VPC Flow Logs for network monitoring
- [ ] Implement AWS Backup for RDS
- [ ] Add AWS WAF for API protection (if exposing endpoints)
- [ ] Create data documentation in Glue Data Catalog

## 📖 References

- [AWS DMS Documentation](https://docs.aws.amazon.com/dms/)
- [Kinesis Data Streams](https://docs.aws.amazon.com/kinesis/)
- [AWS Glue Documentation](https://docs.aws.amazon.com/glue/)
- [Amazon Athena](https://docs.aws.amazon.com/athena/)
- [Terraform AWS Provider](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)

## 📝 License

This infrastructure code is provided as-is for educational and development purposes.

## 🤝 Support

For issues or questions:
1. Check the Troubleshooting section above
2. Review Terraform plan output for errors
3. Check AWS CloudWatch Logs for service-specific issues
4. Review AWS service quotas and limits

---

**Built with ❤️ using Terraform and AWS**
