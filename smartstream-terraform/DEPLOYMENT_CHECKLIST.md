# SmartStream Deployment Checklist

Use this checklist for current SmartStream Terraform deployments.

## 1. Pre-Deployment

- [ ] AWS CLI configured and identity verified
  ```bash
  aws sts get-caller-identity
  ```
- [ ] Terraform `>= 1.5.0` installed
  ```bash
  terraform version
  ```
- [ ] Chosen deployment target:
  - [ ] Legacy bootstrap (`create_shared_iam=true`)
  - [ ] Tenant workspace (`create_shared_iam=false`)
- [ ] `terraform.tfvars` reviewed and aligned to selected mode
  ```bash
  cd smartstream-terraform
  cp terraform.tfvars.example terraform.tfvars
  ```
- [ ] Required IAM permissions available (see `IAM_PERMISSIONS.md`)

## 2. Terraform Plan and Apply

- [ ] Initialize Terraform
  ```bash
  terraform init
  ```
- [ ] Validate and format check
  ```bash
  terraform fmt -check -recursive
  terraform validate
  ```
- [ ] Select/create correct workspace
  ```bash
  # legacy
  terraform workspace select newaccount || terraform workspace new newaccount

  # tenant example
  terraform workspace select acme || terraform workspace new acme
  ```
- [ ] Run mode-correct plan
  ```bash
  # legacy
  terraform plan -var 'enable_tenant_prefix=false' -var 'create_shared_iam=true'

  # tenant
  terraform plan \
    -var 'enable_tenant_prefix=true' \
    -var 'company_name=acme' \
    -var 'environment=dev' \
    -var 'create_shared_iam=false'
  ```
- [ ] Apply
  ```bash
  terraform apply
  ```

## 3. Output Verification

- [ ] Capture key outputs
  ```bash
  terraform output -raw live_api_base_url
  terraform output -raw data_lake_bucket_name
  terraform output -raw dms_replication_task_arn
  terraform output -raw dms_finance_replication_task_arn
  terraform output -raw accounts_table_name
  terraform output -raw companies_table_name
  terraform output -raw invites_table_name
  ```

## 4. Source Database Setup

- [ ] Connect to RDS and create required schemas/tables
- [ ] Ensure at least:
  - `public.employees`
  - `finance.transactions`
  - `finance.accounts`
- [ ] Insert sample data in employees and transactions

## 5. Pipeline Health Checks

- [ ] Confirm both DMS tasks are running (tasks are configured to auto-start)
  ```bash
  aws dms describe-replication-tasks --filters Name=replication-task-arn,Values=$(terraform output -raw dms_replication_task_arn)
  aws dms describe-replication-tasks --filters Name=replication-task-arn,Values=$(terraform output -raw dms_finance_replication_task_arn)
  ```
- [ ] Verify raw objects in S3
  ```bash
  aws s3 ls s3://$(terraform output -raw data_lake_bucket_name)/raw/ --recursive | head
  ```
- [ ] Verify trusted objects in S3
  ```bash
  aws s3 ls s3://$(terraform output -raw data_lake_bucket_name)/trusted/ --recursive | head
  ```
- [ ] Verify analytics outputs (after schedules/manual invokes)
  ```bash
  aws s3 ls s3://$(terraform output -raw data_lake_bucket_name)/trusted-analytics/ --recursive | head
  ```

## 6. Glue and Athena

- [ ] Run trusted crawler
  ```bash
  aws glue start-crawler --name $(terraform output -raw glue_trusted_crawler_name)
  ```
- [ ] Run analytics crawler
  ```bash
  aws glue start-crawler --name $(terraform output -raw glue_analytics_crawler_name)
  ```
- [ ] Confirm tables visible in Glue database

## 7. Auth/Tenant Seed Data

- [ ] Add active company record to companies table (`company_id`, `status=active`)
- [ ] Add invite code record to invites table for first user
- [ ] Complete `POST /auth/signup` with invite code
- [ ] Verify `GET /auth/me` returns expected company and role

## 8. API Endpoint Smoke Tests

- [ ] Login returns token
- [ ] Protected routes succeed with bearer token:
  - [ ] `/dashboard`
  - [ ] `/forecasts`
  - [ ] `/anomalies`
  - [ ] `/query`
- [ ] Admin invite route works for admin role only

## 9. Frontend Verification

- [ ] Set `frontend/.env.local` with `VITE_API_BASE_URL`
- [ ] Run frontend locally
  ```bash
  cd ../frontend
  npm ci
  npm run dev
  ```
- [ ] Validate login/signup, page navigation, and data refreshes

## 10. Observability

- [ ] Open CloudWatch dashboard
- [ ] Check Lambda log groups for transform/ML/anomaly/live API
- [ ] Confirm no sustained alarms in pipeline composite alarm

## 11. Known Alignment Check

- [ ] Confirm tenant data path strategy is aligned
  - Transform currently writes `trusted/employees/...` and `trusted/finance/...`
  - Live API enforces tenant-scoped prefixes based on company context
  - If needed, migrate or duplicate data to tenant-scoped prefixes

## 12. Validation Tests

- [ ] Run unit tests from repo root
  ```bash
  python -m unittest discover -s tests -v
  ```
- [ ] Optionally run Terraform tests
  ```bash
  cd smartstream-terraform
  terraform test
  ```

## 13. Decommissioning

- [ ] Stop DMS tasks
  ```bash
  aws dms stop-replication-task --replication-task-arn $(terraform output -raw dms_replication_task_arn)
  aws dms stop-replication-task --replication-task-arn $(terraform output -raw dms_finance_replication_task_arn)
  ```
- [ ] Empty S3 buckets
  ```bash
  aws s3 rm s3://$(terraform output -raw data_lake_bucket_name) --recursive
  aws s3 rm s3://$(terraform output -raw athena_results_bucket_name) --recursive
  ```
- [ ] Run destroy
  ```bash
  terraform destroy
  ```

## Deployment Notes

- Deployment date:
- Deployed by:
- Workspace:
- Target mode:
- Region:
- Issues observed:
