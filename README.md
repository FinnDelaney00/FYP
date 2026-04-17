# SmartStream

SmartStream is a full-stack final-year project that combines AWS infrastructure, serverless data processing, machine learning, anomaly detection, a business-facing dashboard, and an operations monitor in one repository.

At a high level, the platform:

- captures PostgreSQL change data with AWS DMS
- streams that data through Kinesis and Firehose into an S3 data lake
- transforms raw CDC events into cleaned trusted datasets
- generates forecast and anomaly outputs on a schedule
- serves tenant-scoped business data through a Live API
- exposes pipeline health through a separate Ops API
- provides two Vite-powered frontends: one for business users and one for operations/admin users

## Project Goals

This repository is designed to demonstrate an end-to-end modern data platform rather than a single isolated application. It shows how ingestion, transformation, analytics, APIs, UI, monitoring, tenancy, and testing fit together in one deployable workspace.

## System Architecture

```text
PostgreSQL (source system)
  -> AWS DMS
  -> Kinesis Data Stream
  -> Firehose
  -> S3 raw/
  -> Transform Lambda
  -> S3 trusted/<tenant-prefix>/...
  -> Glue Crawlers + Athena
  -> ML Forecast Lambda
  -> S3 trusted-analytics/<tenant-prefix>/predictions/...
  -> Anomaly Lambda
  -> S3 trusted-analytics/<tenant-prefix>/anomalies/...
  -> Live API Lambda + API Gateway HTTP API
  -> frontend/ business dashboard

CloudWatch metrics/logs/alarms
  -> Ops API Lambda + API Gateway HTTP API
  -> monitor/ operations dashboard
```

## End-to-End Data Flow

1. PostgreSQL changes are replicated by AWS DMS.
2. DMS publishes CDC messages into a Kinesis stream.
3. Firehose batches and compresses those messages into `raw/` objects in the data lake.
4. The transform Lambda is triggered by new raw objects and writes normalized JSON lines into the trusted zone.
5. Glue crawlers catalog both trusted and analytics zones, and Athena is used for controlled read-only querying.
6. The ML Lambda reads recent trusted employee and finance data, trains forecasting models, and writes prediction documents.
7. The anomaly Lambda reads recent trusted finance data, scores it with IsolationForest, and writes anomaly documents.
8. The Live API reads tenant-specific trusted and analytics data and serves dashboard, forecast, anomaly, auth, and query endpoints.
9. The business frontend polls the Live API and renders the user-facing workspace.
10. The Ops API builds a normalized health snapshot from CloudWatch, DMS, S3 freshness, and logs for the monitoring frontend.

## Repository Guide

The table below covers the folders that matter for development and maintenance. Generated or cache directories such as `node_modules/`, `.terraform/`, `dist/`, `coverage/`, and temporary pytest folders are intentionally not documented here.

| Path | Purpose | Detailed guide |
| --- | --- | --- |
| `.github/` | GitHub automation and CI workflow definitions | [README-github.md](.github/README-github.md) |
| `frontend/` | Business dashboard frontend used by authenticated tenants | [README-frontend.md](frontend/README-frontend.md) |
| `monitor/` | Operations/engineering monitoring frontend | [README-monitor.md](monitor/README-monitor.md) |
| `smartstream-terraform/` | AWS infrastructure, Lambda packaging, and deployment configuration | [README-terraform.md](smartstream-terraform/README-terraform.md) |
| `smartstream-terraform/lambdas/` | All serverless application code | [README-lambdas.md](smartstream-terraform/lambdas/README-lambdas.md) |
| `smartstream-terraform/layers/` | Shared Python layer inputs and packaged ML dependencies | [README-layers.md](smartstream-terraform/layers/README-layers.md) |
| `smartstream-terraform/scripts/` | Helper scripts used by Terraform packaging | [README-scripts.md](smartstream-terraform/scripts/README-scripts.md) |
| `smartstream-terraform/tests/` | Terraform plan-level tests and guardrails | [README-terraform-tests.md](smartstream-terraform/tests/README-terraform-tests.md) |
| `tests/` | Python backend unit and integration test suite | [README-tests.md](tests/README-tests.md) |

## Main Components

### 1. Infrastructure

Terraform provisions the core AWS estate:

- VPC, subnets, route tables, NAT, and security groups
- RDS PostgreSQL as the source database
- Secrets Manager for database credentials
- DMS replication instance, endpoints, and replication tasks
- Kinesis Data Stream and Firehose delivery stream
- S3 buckets for raw, trusted, analytics, Athena results, and static web hosting
- Glue database and crawlers
- Athena workgroup and example named queries
- Lambda functions for transform, forecasting, anomaly detection, Live API, and Ops API
- DynamoDB tables for accounts, invites, companies, and anomaly review state
- CloudWatch dashboard, alarms, logs, and SNS topic
- API Gateway HTTP APIs for business and operations access
- optional CloudFront configuration for frontend hosting

### 2. Business Frontend

The `frontend/` app is a Vite + vanilla JS single-page application for business users. It includes:

- invite-based signup and login
- tenant-scoped dashboard metrics
- custom charts
- controlled SQL exploration through a safe query endpoint
- anomaly inbox and review actions
- forecast and workforce outlook views
- settings for account, theme, accessibility, and tenant information

### 3. Operations Frontend

The `monitor/` app is a separate Vite + vanilla JS dashboard for platform health. It shows:

- overall pipeline health summary
- pipeline-by-pipeline status and severity
- CloudWatch alarm rollups
- recent log summaries
- drill-down details per pipeline
- live data, partial-data, mixed-data, or mock-data state

### 4. Lambda Services

| Lambda | Main responsibility | Runtime |
| --- | --- | --- |
| `transform` | Raw CDC cleanup and trusted-zone writes | Python 3.11 |
| `ml` | Forecast generation from trusted employee and finance data | Python 3.11 |
| `anomaly` | Finance anomaly detection and anomaly document output | Python 3.11 |
| `live_api` | Auth, dashboard, forecasts, anomalies, admin invites, safe query execution | Python 3.12 |
| `ops_api` | CloudWatch/DMS/S3 health aggregation for operations UI | Python 3.12 |

## Technology Summary

| Area | Stack |
| --- | --- |
| Infrastructure | Terraform `>= 1.5`, AWS provider `~> 5.0` |
| Frontends | Vite, vanilla JS, HTML, CSS, Vitest, jsdom |
| Backend compute | AWS Lambda |
| Backend language | Python |
| Data capture | AWS DMS |
| Streaming | Kinesis Data Streams, Firehose |
| Storage | S3, DynamoDB |
| Query layer | Glue Data Catalog, Athena |
| Monitoring | CloudWatch dashboards, logs, alarms, SNS |
| CI | GitHub Actions and Jenkins |
| ML | pandas, numpy, scikit-learn |

## Prerequisites

To work comfortably in this repository, you should have:

- Node.js 20 or newer
- npm
- Python 3.11 or newer
- Terraform 1.5 or newer
- AWS CLI configured for the target account
- permissions to create the AWS resources defined in Terraform

## Quick Start

### 1. Install local dependencies

From the repository root:

```powershell
python -m pip install -r requirements-dev.txt
Set-Location frontend
npm ci
Set-Location ..\monitor
npm ci
Set-Location ..
```

### 2. Deploy infrastructure

Use `smartstream-terraform/terraform.tfvars.example` as the starting point, then choose either legacy/shared mode or tenant mode.

Legacy/shared example:

```powershell
Set-Location smartstream-terraform
terraform init
terraform workspace select newaccount
Copy-Item terraform.tfvars.example terraform.tfvars
terraform plan
terraform apply
```

Tenant example:

```powershell
Set-Location smartstream-terraform
terraform init
terraform workspace new acme
Copy-Item terraform.tfvars.example terraform.tfvars
```

Then set the tenant-specific values in `terraform.tfvars`:

```hcl
enable_tenant_prefix = true
company_name         = "acme"
environment          = "dev"
create_shared_iam    = false
```

And run:

```powershell
terraform plan
terraform apply
```

### 3. Capture the important outputs

```powershell
terraform output -raw live_api_base_url
terraform output -raw ops_api_base_url
terraform output -raw data_lake_bucket_name
terraform output -raw web_bucket_name
terraform output -raw cloudfront_domain_name
```

### 4. Run the business frontend locally

Create `frontend/.env.local`:

```env
VITE_API_BASE_URL=https://<live-api-id>.execute-api.<region>.amazonaws.com
```

Then run:

```powershell
Set-Location ..\frontend
npm run dev
```

### 5. Run the monitor locally

Create `monitor/.env.local`:

```env
VITE_MONITOR_API_BASE_URL=https://<ops-api-id>.execute-api.<region>.amazonaws.com
VITE_MONITOR_USE_MOCK=false
VITE_MONITOR_REFRESH_INTERVAL_MS=60000
VITE_MONITOR_AUTH_TOKEN=
VITE_MONITOR_AUTH_TOKEN_STORAGE_KEY=smartstream_auth_token
```

Then run:

```powershell
Set-Location ..\monitor
npm run dev
```

### 6. Run tests

```powershell
Set-Location c:\dev\FYP - Copy
python -m pytest
Set-Location frontend
npm run lint
npm test
Set-Location ..\monitor
npm test
Set-Location ..\smartstream-terraform
terraform init -backend=false
terraform validate
terraform test
```

For the full testing story, see [TESTING.md](TESTING.md) and [tests/README-tests.md](tests/README-tests.md).

## Deployment Modes

This stack supports two deployment styles:

| Mode | Intended use | Key settings |
| --- | --- | --- |
| Legacy/shared bootstrap | Initial shared workspace that owns common IAM roles and preserves older naming | `enable_tenant_prefix=false`, `create_shared_iam=true`, workspace `newaccount` |
| Tenant/company deployment | Company-specific stack that reuses shared IAM and isolates data by prefix | `enable_tenant_prefix=true`, `company_name=<tenant>`, `environment=dev|test|prod`, `create_shared_iam=false`, workspace must match normalized company name |

Terraform checks in `guardrails.tf` enforce these combinations so unsafe workspace/variable mixes fail early.

## Data Layout

| Zone | Typical path | Meaning |
| --- | --- | --- |
| Raw | `raw/yyyy/MM/dd/HH/...` | Firehose-delivered CDC objects before transformation |
| Trusted | `trusted/<tenant-prefix>/employees/...` and `trusted/<tenant-prefix>/finance/...` | Cleaned records used by APIs and ML jobs |
| Trusted analytics | `trusted-analytics/<tenant-prefix>/predictions/...` and `trusted-analytics/<tenant-prefix>/anomalies/...` | Derived outputs from forecasting and anomaly jobs |
| Deployment artifacts | `deployment-artifacts/layers/<tenant-prefix>/...` | Packaged Lambda layer assets stored in S3 |

One important nuance: the transform Lambda writes under `PIPELINE_COMPANY_ID`, which Terraform sets to `local.name_prefix`. In tenant mode that usually means a value like `acme-dev`, not plain `acme`. The Live API can resolve this correctly because company metadata in DynamoDB can override the default trusted and analytics prefixes.

## API Surface

### Live API

The Live API is the business-facing HTTP API used by the `frontend/` app.

| Route | Purpose |
| --- | --- |
| `POST /auth/signup` | Create a new user from an invite code |
| `POST /auth/login` | Authenticate and receive a signed token |
| `GET /auth/me` | Return the authenticated user and company context |
| `POST /admin/invites` | Admin-only invite creation |
| `GET /latest` | Recent finance data feed for the tenant |
| `GET /dashboard` | Dashboard metrics and charts |
| `GET /forecasts` | Forecast payload from latest prediction file |
| `GET /anomalies` | Anomaly list with filters and review-state merge |
| `GET /anomalies/{id}` | Anomaly detail view |
| `POST /anomalies/{id}/actions` | Review workflow updates |
| `POST /query` | Safe read-only Athena-backed query execution |

The `/query` endpoint is intentionally restrictive. It is designed for simple read-only `SELECT` usage against trusted data and blocks destructive SQL, joins, unions, comments, and other unsafe patterns.

### Ops API

The Ops API is a read-only HTTP API used by the `monitor/` app.

| Route | Purpose |
| --- | --- |
| `GET /ops/overview` | High-level pipeline health summary |
| `GET /ops/pipelines` | Normalized pipeline rows for the main table |
| `GET /ops/pipelines/{id}` | Per-pipeline drill-down detail |
| `GET /ops/alarms` | Active alarm list |
| `GET /ops/log-summary` | Recent service/log rollups |

Authentication for the Ops API is optional and controlled by `ops_api_require_auth` and `ops_api_required_role`.

## Testing And CI

This repo has several validation layers:

- Python `pytest` for Lambda logic, auth, tenant scoping, and integration-style workflows
- Vitest + jsdom for `frontend/`
- Vitest + jsdom for `monitor/`
- `terraform validate` and `terraform test` for infrastructure checks
- GitHub Actions in `.github/workflows/lint.yml`
- a Windows-oriented `Jenkinsfile` that validates parameters, selects workspaces, and runs Terraform planning

## Important Implementation Notes

- Auth tokens are lightweight HMAC-signed tokens generated by the Live API Lambda, not Cognito tokens.
- The business frontend stores its auth token in browser local storage under `smartstream_auth_token`.
- Browser-side user preferences are stored under `smartstream_preferences`.
- Profile update, password change, and revoke-session actions exist in the frontend, but they only become functional if optional environment variables point to supporting backend endpoints.
- The monitor prefers live data, but it will fall back to mock data if the base URL is missing or a live request fails with a 5xx/network-style error. It deliberately does not hide 4xx configuration errors.
- CloudFront is provisioned in Terraform but currently `enabled = false`.
- `networking.tf` hardcodes availability zones for `eu-north-1`. If you deploy to another region, review that file before applying.
- `rds.tf` currently sets the database to `publicly_accessible = true`, which is convenient for demos but not a production-hardened posture.

## Recommended Reading Order

If you are new to the repo, the fastest way to understand it is:

1. read this file for the big picture
2. read [smartstream-terraform/README-terraform.md](smartstream-terraform/README-terraform.md) for deployment and AWS layout
3. read [frontend/README-frontend.md](frontend/README-frontend.md) and [monitor/README-monitor.md](monitor/README-monitor.md) for app behavior
4. read [tests/README-tests.md](tests/README-tests.md) and [TESTING.md](TESTING.md) for verification evidence

## Additional Documentation

- [TESTING.md](TESTING.md)
- [frontend/README-frontend.md](frontend/README-frontend.md)
- [monitor/README-monitor.md](monitor/README-monitor.md)
- [smartstream-terraform/README-terraform.md](smartstream-terraform/README-terraform.md)
- [smartstream-terraform/lambdas/README-lambdas.md](smartstream-terraform/lambdas/README-lambdas.md)
- [smartstream-terraform/layers/README-layers.md](smartstream-terraform/layers/README-layers.md)
- [smartstream-terraform/scripts/README-scripts.md](smartstream-terraform/scripts/README-scripts.md)
- [smartstream-terraform/tests/README-terraform-tests.md](smartstream-terraform/tests/README-terraform-tests.md)
- [tests/README-tests.md](tests/README-tests.md)
- [.github/README-github.md](.github/README-github.md)
