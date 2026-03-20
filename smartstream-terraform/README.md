# SmartStream Terraform Infrastructure

Terraform code for the SmartStream AWS platform, including ingestion, streaming, data lake zones, analytics, live API, and frontend hosting resources.

## What This Stack Provisions

Core services:

- VPC, subnets, route tables, NAT gateway, security groups, S3 VPC endpoint
- RDS PostgreSQL + Secrets Manager credentials
- DMS replication instance, endpoints, and two replication tasks
- Kinesis Data Stream + Firehose delivery to S3 raw zone
- S3 data lake bucket + Athena results bucket
- Transform Lambda (S3 event)
- ML inference Lambda (EventBridge schedule)
- Anomaly detection Lambda (EventBridge schedule)
- Live API Lambda + API Gateway HTTP API + DynamoDB auth/review tables
- Ops API Lambda + API Gateway HTTP API for engineer/admin monitoring
- Glue catalog database + trusted/analytics crawlers
- Athena workgroup + sample named queries
- CloudWatch dashboard/alarms + SNS topic
- Web hosting S3 bucket + CloudFront distribution resources

## Deployment Modes

The project supports a shared legacy workspace plus tenant workspaces.

### 1. Legacy bootstrap mode

Use for initial shared IAM creation and legacy-compatible naming:

- `enable_tenant_prefix = false`
- `create_shared_iam = true`
- workspace typically `newaccount`

### 2. Tenant mode

Use for company-specific deployment:

- `enable_tenant_prefix = true`
- `company_name = "<company>"`
- `environment = "dev|test|prod"`
- `create_shared_iam = false`
- workspace must match normalized `company_name`

## Guardrails (Enforced)

`guardrails.tf` enforces:

- Tenant mode requires `company_name`.
- Tenant workspace must match normalized company name.
- Tenant mode cannot create shared IAM.
- Shared IAM creation is restricted to `legacy_workspace_name`.
- Tenant bucket names must satisfy S3 naming constraints.
- In tenant mode, shared IAM role discovery must resolve uniquely (or use explicit overrides).

## Data Flow

```text
RDS PostgreSQL
  -> DMS task: public schema tables
  -> DMS task: finance schema selected tables
  -> Kinesis stream
  -> Firehose
  -> S3 raw/
  -> Transform Lambda
  -> S3 trusted/{company_id}/employees/... + trusted/{company_id}/finance/...
  -> ML Lambda (scheduled)
  -> S3 trusted-analytics/{company_id}/predictions/...
  -> Anomaly Lambda (scheduled)
  -> S3 trusted-analytics/{company_id}/anomalies/...
  -> Live API Lambda
  -> API Gateway HTTP API
  -> Frontend
```

## Live API and Auth Resources

Terraform creates:

- DynamoDB accounts table
- DynamoDB companies table
- DynamoDB invites table
- DynamoDB anomaly-reviews table
- API routes for auth, dashboard, forecasts, anomalies, and query

Auth model in current lambda code:

- Signup requires invite code.
- `company_id` is derived from invite/account, not trusted from client input.
- Protected routes require active account and active company.

## Ops API and Monitor Dashboard

Terraform now provisions a separate monitoring backend for the `monitor/` app:

- Lambda: `aws_lambda_function.ops_api`
- HTTP API: `aws_apigatewayv2_api.ops_api`
- Routes:
  - `GET /ops/overview`
  - `GET /ops/pipelines`
  - `GET /ops/pipelines/{id}`
  - `GET /ops/alarms`
  - `GET /ops/log-summary`

The ops Lambda reads health telemetry from:

- CloudWatch alarms
- CloudWatch metrics for DMS, Kinesis, Firehose, and Lambda
- CloudWatch Logs `filter_log_events` summaries
- S3 trusted/trusted-analytics object freshness

The monitor frontend should call this API, not AWS directly from the browser.

### Ops API auth

Two Terraform variables control admin protection:

- `ops_api_require_auth` (`false` by default)
- `ops_api_required_role` (`admin` by default)

When auth is enabled, the ops Lambda expects the same signed bearer token shape used by the live API and validates the account/company state via DynamoDB.

## Important Current Behavior

1. Pipeline output and API reads are tenant-scoped:
- `trusted/{company_id}/...`
- `trusted-analytics/{company_id}/...`

2. Legacy objects that still exist only in shared prefixes are not returned by tenant-scoped API routes until they are copied or regenerated under the matching tenant path.

3. New source data inserted into the replicated database will only surface automatically after these Lambda/Terraform changes are deployed to the target environment.

## Prerequisites

- Terraform `>= 1.5.0`
- AWS CLI configured
- IAM permissions to create/manage listed AWS resources
- For tenant mode with `create_shared_iam=false`: ability to discover/pass existing shared IAM roles

## Quick Start

### Option A: Legacy bootstrap workspace

```bash
cd smartstream-terraform
terraform init
terraform workspace select newaccount || terraform workspace new newaccount
terraform plan -var 'enable_tenant_prefix=false' -var 'create_shared_iam=true'
terraform apply -var 'enable_tenant_prefix=false' -var 'create_shared_iam=true'
```

### Option B: Tenant workspace

Example for company `acme` in `dev`:

```bash
cd smartstream-terraform
terraform init
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

## Post-Apply Checks

```bash
terraform output
terraform output -raw live_api_base_url
terraform output -raw ops_api_base_url
terraform output -raw data_lake_bucket_name
terraform output -raw dms_replication_task_arn
terraform output -raw dms_finance_replication_task_arn
```

Both DMS tasks are configured with `start_replication_task = true`.

## Verifying The Ops API

Without auth:

```bash
curl "$(terraform output -raw ops_api_base_url)/ops/overview"
curl "$(terraform output -raw ops_api_base_url)/ops/pipelines"
```

With auth enabled:

```bash
curl \
  -H "Authorization: Bearer <token>" \
  "$(terraform output -raw ops_api_base_url)/ops/overview"
```

The response envelope is:

```json
{
  "data": {},
  "meta": {
    "source": "live",
    "partial_data": false,
    "warnings": [],
    "generated_at": "2026-03-13T12:00:00+00:00"
  }
}
```

`partial_data=true` means the Lambda answered successfully but one or more AWS telemetry sources were unavailable.

## Minimum Source Schema

Use a source database layout compatible with current transform/anomaly/ML logic:

```sql
CREATE SCHEMA IF NOT EXISTS finance;

CREATE TABLE IF NOT EXISTS public.employees (
  id SERIAL PRIMARY KEY,
  department TEXT,
  employment_status TEXT,
  email TEXT,
  salary NUMERIC(12,2),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS finance.transactions (
  id SERIAL PRIMARY KEY,
  employee_id INT,
  transaction_date DATE,
  amount NUMERIC(12,2),
  type TEXT,
  category TEXT,
  vendor TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS finance.accounts (
  id SERIAL PRIMARY KEY,
  account_name TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Frontend Hosting

Terraform creates:

- Web S3 bucket (`aws_s3_bucket.web`)
- CloudFront origin access control + distribution

Current default in code: CloudFront distribution is disabled (`enabled = false`).

Deployment commands are output via:

```bash
terraform output frontend_deploy_commands
```

## Testing

### Python unit tests (repo root)

```bash
python -m unittest discover -s tests -v
```

### Terraform formatting/validation

```bash
terraform fmt -check -recursive
terraform validate
```

### Terraform integration test fixture

```bash
terraform test
```

## Jenkins Pipeline

`Jenkinsfile` includes:

- parameters: `TARGET` (`tenant|legacy`), `ACTION` (`plan|apply|destroy`), `COMPANY`, `ENV`
- workspace resolution and normalization for tenant names
- mode-specific variable injection
- manual approval step for apply/destroy

## Cleanup

```bash
# Optional: stop both DMS tasks first
aws dms stop-replication-task --replication-task-arn $(terraform output -raw dms_replication_task_arn)
aws dms stop-replication-task --replication-task-arn $(terraform output -raw dms_finance_replication_task_arn)

# Empty buckets before destroy
aws s3 rm s3://$(terraform output -raw data_lake_bucket_name) --recursive
aws s3 rm s3://$(terraform output -raw athena_results_bucket_name) --recursive

terraform destroy
```
