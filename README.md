# SmartStream: End-to-End Data Pipeline and Live Analytics

SmartStream is a full-stack AWS data platform prototype. It streams source data from PostgreSQL, transforms it into a trusted data lake zone, generates forecast insights, and serves an authenticated live analytics API for a browser dashboard.

This repository is the top-level project workspace. It contains:

- Terraform infrastructure (`smartstream-terraform/`)
- Lambda application code (transform, ML inference, live API)
- Frontend dashboard (`frontend/`)
- Python unit tests (`tests/`)

## Architecture at a Glance

```text
PostgreSQL (RDS)
  -> DMS (CDC)
  -> Kinesis Data Stream
  -> Firehose
  -> S3 raw/
  -> Transform Lambda
  -> S3 trusted/{employees|finance}/...
  -> ML Inference Lambda (scheduled)
  -> S3 trusted-analytics/predictions/
  -> Anomaly Detection Lambda (scheduled)
  -> S3 trusted-analytics/anomalies/
  -> Live API Lambda + API Gateway
  -> Frontend dashboard (Vite app, deployable to S3)
```

Glue crawlers and Athena are provisioned for cataloging and SQL analytics.

## Repository Structure

```text
.
|-- README.md
|-- tests/
|   |-- test_transform_lambda.py
|   |-- test_ml_inference_lambda.py
|   `-- test_live_api_lambda.py
|-- frontend/
|   |-- package.json
|   |-- index.html
|   `-- src/
`-- smartstream-terraform/
    |-- *.tf
    `-- lambdas/
        |-- transform/lambda_function.py
        |-- ml/lambda_function.py
        `-- live_api/lambda_function.py
```

## Key Components

### Transform Lambda

File: `smartstream-terraform/lambdas/transform/lambda_function.py`

- Triggered by S3 `ObjectCreated` events on `raw/`
- Reads JSON/JSONL (including `.gz`)
- Filters DMS control records and unsupported tables
- Routes records to:
  - `trusted/employees/<table>/...`
  - `trusted/finance/<table>/...`
- Removes null/empty fields, normalizes timestamps, de-duplicates rows

### ML Inference Lambda

File: `smartstream-terraform/lambdas/ml/lambda_function.py`

- Reads recent trusted employee and finance files
- Builds:
  - employee headcount trend + forecast
  - revenue and expenditure trend + forecast
- Writes output JSON to:
  - `trusted-analytics/predictions/YYYY/MM/DD/predictions_<timestamp>.json`

### Anomaly Detection Lambda

File: `smartstream-terraform/lambdas/anomaly/lambda_function.py`

- Runs on EventBridge schedule (`anomaly_schedule_expression`, default `rate(2 hours)`)
- Reads trusted employee and finance transaction data
- Detects:
  - salary outliers
  - duplicate hires / likely duplicate employees
  - duplicate transactions
  - unusually large transactions
  - unusually small suspicious transactions
- Writes anomaly JSON to:
  - `trusted-analytics/anomalies/YYYY/MM/DD/anomalies_<timestamp>.json`

### Live API Lambda

File: `smartstream-terraform/lambdas/live_api/lambda_function.py`

- HTTP API (API Gateway v2) endpoints:
  - `POST /auth/signup`
  - `POST /auth/login`
  - `GET /auth/me`
  - `GET /latest`
  - `GET /dashboard`
  - `GET /forecasts`
  - `GET /anomalies`
  - `GET /anomalies/{id}`
  - `POST /anomalies/{id}/actions`
  - `POST /query`
- Uses DynamoDB for user accounts and anomaly review/audit state
- Uses Athena for read-only SQL queries (`SELECT`/`WITH` only)
- Requires bearer token auth on non-auth routes

## Prerequisites

- AWS account with permissions to create networking, compute, storage, IAM, and analytics resources
- Terraform >= 1.5
- AWS CLI configured (`aws configure`)
- Python 3.11+ (for local tests)
- Node.js 20+ and npm (for frontend)

## Quick Start (Infrastructure)

```bash
cd smartstream-terraform
terraform init
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` for your environment, then:

```bash
terraform plan
terraform apply
```

Get important outputs:

```bash
terraform output
terraform output -raw live_api_base_url
terraform output -raw data_lake_bucket_name
```

## Seed Source Data (Minimum)

After deployment, connect to RDS and create the source tables expected by the pipeline:

```sql
CREATE SCHEMA IF NOT EXISTS finance;

CREATE TABLE IF NOT EXISTS public.employees (
  id SERIAL PRIMARY KEY,
  department TEXT,
  employment_status TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS finance.transactions (
  id SERIAL PRIMARY KEY,
  employee_id INT,
  transaction_date DATE,
  amount NUMERIC(12,2),
  type TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Insert sample rows into both tables and verify files appear under:

- `s3://<data-lake-bucket>/raw/`
- `s3://<data-lake-bucket>/trusted/`
- `s3://<data-lake-bucket>/trusted-analytics/predictions/`

## Frontend Local Development

```bash
cd frontend
npm ci
```

Create `frontend/.env.local`:

```env
VITE_API_BASE_URL=https://<api-id>.execute-api.<region>.amazonaws.com
VITE_POLL_INTERVAL_MS=3000
```

Run locally:

```bash
npm run dev
```

Build for deployment:

```bash
npm run build
```

## Frontend Deployment (S3/CloudFront)

The Terraform outputs include helper commands:

```bash
cd smartstream-terraform
terraform output frontend_deploy_commands
```

Typical flow:

```bash
cd frontend
npm ci && npm run build
aws s3 sync dist s3://<web_bucket_name> --delete
aws cloudfront create-invalidation --distribution-id <distribution_id> --paths "/*"
```

Note: `smartstream-terraform/cloudfront.tf` currently sets `enabled = false`. If you want public CDN delivery, set it to `true` and re-apply Terraform.

## Testing and Validation

Run Python unit tests from repo root:

```bash
python -m unittest discover -s tests -v
```

Run frontend lint:

```bash
cd frontend
npm run lint
```

Run Terraform formatting check:

```bash
terraform -chdir=smartstream-terraform fmt -check -recursive
```

## Useful Terraform Docs in This Repo

- `smartstream-terraform/README.md`
- `smartstream-terraform/DEPLOYMENT_CHECKLIST.md`
- `smartstream-terraform/QUICK_REFERENCE.md`
- `smartstream-terraform/PROJECT_SUMMARY.md`

## Notes

- This repo contains implementation code and tests for pipeline behavior; it is not just infrastructure.
- The live API uses a lightweight custom token flow for prototype use. For production, integrate a managed identity provider and hardened auth controls.
