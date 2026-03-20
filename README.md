# SmartStream Workspace

SmartStream is a full-stack AWS data platform prototype in a single repository.

This workspace contains:

- Terraform infrastructure in `smartstream-terraform/`
- Lambda application code for transform, ML forecasting, anomaly detection, and live API
- Frontend dashboard in `frontend/` (Vite + vanilla JS/HTML/CSS)
- Engineer/admin monitoring dashboard in `monitor/` (separate Vite app)
- Python unit tests in `tests/`

## Current Architecture

```text
RDS PostgreSQL
  -> DMS (task 1: public schema, task 2: finance schema tables)
  -> Kinesis Data Stream
  -> Firehose
  -> S3 raw/
  -> Transform Lambda
  -> S3 trusted/{company_id}/employees/... and trusted/{company_id}/finance/...
  -> ML Lambda (scheduled)
  -> S3 trusted-analytics/{company_id}/predictions/...
  -> Anomaly Lambda (scheduled)
  -> S3 trusted-analytics/{company_id}/anomalies/...
  -> Live API Lambda + API Gateway HTTP API
  -> Frontend dashboard
  -> Ops API Lambda + API Gateway HTTP API
  -> Monitor dashboard
```

Glue crawlers and Athena are provisioned for cataloging and SQL query access.

## Repository Structure

```text
.
|-- README.md
|-- Jenkinsfile
|-- tests/
|   |-- test_transform_lambda.py
|   |-- test_ml_inference_lambda.py
|   |-- test_anomaly_lambda.py
|   `-- test_live_api_lambda.py
|-- frontend/
|   |-- README.md
|   |-- package.json
|   |-- index.html
|   `-- src/
|-- monitor/
|   |-- README.md
|   |-- package.json
|   |-- index.html
|   `-- src/
`-- smartstream-terraform/
    |-- README.md
    |-- DEPLOYMENT_CHECKLIST.md
    |-- QUICK_REFERENCE.md
    |-- PROJECT_SUMMARY.md
    |-- IAM_PERMISSIONS.md
    |-- *.tf
    `-- lambdas/
```

## Live API Surface

Provisioned routes (API Gateway -> `lambdas/live_api/lambda_function.py`):

- `POST /auth/signup`
- `POST /auth/login`
- `GET /auth/me`
- `POST /admin/invites` (admin only)
- `GET /latest`
- `GET /dashboard`
- `GET /forecasts`
- `GET /anomalies`
- `GET /anomalies/{id}`
- `POST /anomalies/{id}/actions`
- `POST /query`

Key behaviors in the current implementation:

- Invite-based signup (`invite_code` required).
- Auth tokens include `company_id` and `role`.
- Protected routes enforce company isolation from auth context.
- `/query` only allows read-only, single-statement, simple `SELECT ... FROM trusted ...` queries and resolves the authenticated tenant's Glue table server-side.

Separate ops/admin routes are now provisioned by a dedicated monitoring Lambda:

- `GET /ops/overview`
- `GET /ops/pipelines`
- `GET /ops/pipelines/{id}`
- `GET /ops/alarms`
- `GET /ops/log-summary`

## Deployment Modes (Terraform)

The Terraform stack supports two modes:

1. Legacy/shared workspace bootstrap:
- `enable_tenant_prefix=false`
- `create_shared_iam=true`
- workspace defaults to `newaccount`

2. Tenant/company workspace:
- `enable_tenant_prefix=true`
- `company_name=<company>`
- `environment=dev|test|prod`
- `create_shared_iam=false`
- workspace must match normalized `company_name`

Guardrails in `guardrails.tf` enforce safe combinations.

## Quick Start

### 1. Deploy infrastructure

```bash
cd smartstream-terraform
terraform init
cp terraform.tfvars.example terraform.tfvars
terraform plan
terraform apply
```

### 2. Check key outputs

```bash
terraform output -raw live_api_base_url
terraform output -raw data_lake_bucket_name
terraform output -raw web_bucket_name
```

### 3. Run frontend locally

```bash
cd ../frontend
npm ci
```

Create `frontend/.env.local`:

```env
VITE_API_BASE_URL=https://<api-id>.execute-api.<region>.amazonaws.com
```

Run:

```bash
npm run dev
```

### 4. Run the monitor locally against live ops data

Deploy Terraform first, then read the ops API base URL:

```bash
cd ../smartstream-terraform
terraform output -raw ops_api_base_url
```

Create `monitor/.env.local`:

```env
VITE_MONITOR_API_BASE_URL=https://<api-id>.execute-api.<region>.amazonaws.com
VITE_MONITOR_USE_MOCK=false
VITE_MONITOR_AUTH_TOKEN=
VITE_MONITOR_AUTH_TOKEN_STORAGE_KEY=smartstream_auth_token
```

Run:

```bash
cd ../monitor
npm install
npm run dev
```

## Tests

From repository root:

```bash
python -m unittest discover -s tests -v
```

Frontend lint:

```bash
cd frontend
npm run lint
```

## Current Notes

- CloudFront is provisioned but currently disabled by default (`smartstream-terraform/cloudfront.tf` has `enabled = false`).
- Pipeline components are configured to write and read tenant-aware prefixes (`trusted/{company_id}/...`, `trusted-analytics/{company_id}/...`).
- Existing objects left in legacy shared prefixes remain invisible to tenant-scoped API endpoints until they are copied or regenerated under the tenant path.
- New source inserts only show up automatically after the updated Lambda/Terraform changes are deployed to the target stack.

## Project Docs

- `smartstream-terraform/README.md`
- `monitor/README.md`
- `smartstream-terraform/DEPLOYMENT_CHECKLIST.md`
- `smartstream-terraform/QUICK_REFERENCE.md`
- `smartstream-terraform/PROJECT_SUMMARY.md`
- `smartstream-terraform/IAM_PERMISSIONS.md`
- `frontend/README.md`
