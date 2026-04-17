# Terraform Guide

This folder owns the SmartStream AWS infrastructure and the packaging rules that turn the Python folders into Lambda deployment artifacts.

## What This Folder Provisions

The Terraform stack creates or configures:

- networking for the data platform
- PostgreSQL source database
- Secrets Manager entries for database credentials
- DMS replication instance and CDC tasks
- Kinesis Data Stream and Firehose delivery
- S3 buckets for raw, trusted, analytics, Athena results, and frontend hosting
- Glue crawlers and Data Catalog database
- Athena workgroup and sample queries
- Lambda functions for transform, ML, anomaly detection, business API, and ops API
- DynamoDB tables for auth and review workflow state
- CloudWatch dashboards, logs, alarms, and SNS alerts
- API Gateway HTTP APIs
- optional CloudFront distribution for static frontend hosting

## Important Files

| File | Purpose |
| --- | --- |
| `versions.tf` | Terraform and provider version constraints |
| `providers.tf` | AWS, archive, and random providers |
| `variables.tf` | Input variables and validation rules |
| `locals.tf` | Naming logic, tags, bucket names, and shared-role resolution |
| `guardrails.tf` | Workspace and deployment-mode safety checks |
| `networking.tf` | VPC, subnets, NAT, routing, security groups, S3 endpoint |
| `rds.tf` | PostgreSQL source database and CDC parameter group |
| `dms.tf` | DMS endpoints, tasks, and replication alarms |
| `kinesis.tf` | Streaming backbone for CDC |
| `firehose.tf` | Delivery from Kinesis into the S3 raw zone |
| `s3.tf` | Data lake and Athena results buckets |
| `lambda_transform.tf` | Raw-to-trusted transformation Lambda |
| `lambda_ml.tf` | Scheduled forecasting Lambda |
| `lambda_anomaly.tf` | Scheduled anomaly detection Lambda |
| `lambda_ml_dependencies.tf` | Python layer build and packaging flow |
| `live_api.tf` | Business API Lambda, DynamoDB tables, API Gateway |
| `ops_api.tf` | Ops API Lambda and API Gateway |
| `glue.tf` | Crawlers and Glue database |
| `athena.tf` | Athena workgroup and sample queries |
| `cloudwatch.tf` | Dashboard, alarms, log metric filters, SNS topic |
| `outputs.tf` | URLs, names, ARNs, and helper commands |

## Deployment Modes And Workspaces

This stack is deliberately split into two deployment patterns.

### Legacy/shared bootstrap mode

Use this when you want the original shared setup and shared IAM resources.

Key settings:

- `enable_tenant_prefix = false`
- `create_shared_iam = true`
- workspace should be `newaccount` unless you intentionally changed `legacy_workspace_name`

### Tenant/company mode

Use this for company-specific deployments with isolated prefixes.

Key settings:

- `enable_tenant_prefix = true`
- `company_name = "<tenant>"`
- `environment = "dev" | "test" | "prod"`
- `create_shared_iam = false`
- workspace must match the normalized company name

Terraform checks in `guardrails.tf` will fail if you mix these modes incorrectly.

## Prerequisites

You should have:

- Terraform 1.5 or newer
- AWS credentials with permission to create the stack
- Python available locally for the ML layer packaging step
- internet/package access when building the Python Lambda layer

## Typical Workflow

Initialize once:

```powershell
Set-Location smartstream-terraform
terraform init
```

Select or create the right workspace:

```powershell
terraform workspace list
terraform workspace select newaccount
```

or:

```powershell
terraform workspace new acme
```

Create `terraform.tfvars` from the example:

```powershell
Copy-Item terraform.tfvars.example terraform.tfvars
```

Then plan and apply:

```powershell
terraform plan
terraform apply
```

## Example Variable Sets

### Legacy/shared example

```hcl
enable_tenant_prefix = false
create_shared_iam    = true
environment          = "dev"
legacy_workspace_name = "newaccount"
```

### Tenant/company example

```hcl
enable_tenant_prefix = true
company_name         = "acme"
environment          = "dev"
create_shared_iam    = false
```

If tenant mode cannot auto-discover the shared role names cleanly, set the explicit `shared_*_role_name` overrides.

## Outputs You Will Use Most Often

After apply, these are the most useful outputs for development:

```powershell
terraform output -raw live_api_base_url
terraform output -raw ops_api_base_url
terraform output -raw data_lake_bucket_name
terraform output -raw web_bucket_name
terraform output -raw rds_endpoint
terraform output -raw glue_database_name
terraform output -json quick_start_commands
terraform output -json frontend_deploy_commands
```

## Nested Folder Guides

- [lambdas/README-lambdas.md](lambdas/README-lambdas.md)
- [layers/README-layers.md](layers/README-layers.md)
- [scripts/README-scripts.md](scripts/README-scripts.md)
- [tests/README-terraform-tests.md](tests/README-terraform-tests.md)

## Operational Notes

- `networking.tf` hardcodes availability zones for `eu-north-1`. Review this before moving regions.
- `rds.tf` currently makes the database publicly accessible. That is convenient for demos and direct tooling access, but it is not a production-hardened default.
- `cloudfront.tf` exists, but the distribution is currently declared with `enabled = false`.
- The ML layer build uses a `terraform_data` + `local-exec` packaging step. That means `terraform apply` can trigger local Python package installation.
- Transform writes trusted data under `PIPELINE_COMPANY_ID`, which Terraform sets to `local.name_prefix`. In tenant mode this is commonly `<company>-<environment>`.
- The Live API can still serve those paths because the company record in DynamoDB may specify explicit `trusted_prefix` and `analytics_prefix`.

## Validation And Safety

This folder has multiple protection layers:

- variable validation blocks in `variables.tf`
- workspace/mode `check` blocks in `guardrails.tf`
- `terraform validate`
- `terraform test`

The plan-level tests assert that important wiring stays intact, including:

- DMS source and target types
- Firehose raw-zone delivery
- transform/ML/live API environment variables
- finance schema overrides
- tenant-mode shared IAM reuse

## Frontend Deployment Notes

The stack also provisions the static web hosting bucket. A typical deployment flow is:

1. build the frontend in `../frontend`
2. sync `dist/` to the `web_bucket_name`
3. invalidate CloudFront if you have enabled it

Terraform exposes a `frontend_deploy_commands` output with helper commands for this flow.
