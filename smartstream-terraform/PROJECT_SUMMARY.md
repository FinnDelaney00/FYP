# SmartStream Project Summary

## Scope

This repository is an end-to-end SmartStream prototype:

- AWS infrastructure as code (Terraform)
- Data processing Lambdas (transform, forecasting, anomaly detection, live API)
- Browser dashboard frontend
- Unit tests for key Lambda logic

## Current State

Implemented and wired:

- CDC ingestion from PostgreSQL through DMS -> Kinesis -> Firehose -> S3 raw
- Transform Lambda from raw to trusted zone
- Scheduled ML forecast generation to trusted-analytics predictions
- Scheduled anomaly detection to trusted-analytics anomalies
- Live API with invite-based auth, tenant-scoped data access, anomaly review actions, and query endpoint
- Dashboard frontend with auth, overview metrics, custom chart preview, query builder, anomaly workflow, and forecasts page

## Deployment Model

Terraform supports:

1. Legacy/shared workspace for shared IAM bootstrap (`create_shared_iam=true`)
2. Tenant workspaces reusing shared IAM (`create_shared_iam=false`)

Safety checks enforce workspace/mode consistency.

## Major Infrastructure Components

- Networking: VPC, public/private subnets, NAT, route tables, security groups, S3 VPC endpoint
- Storage: data lake S3 + Athena results S3 + web hosting S3
- Database/CDC: RDS PostgreSQL + DMS instance/endpoints/tasks
- Streaming: Kinesis stream + Firehose delivery
- Compute: 4 Lambda functions
- Catalog/Query: Glue crawlers + Athena workgroup
- API/Auth: API Gateway HTTP API + DynamoDB tables for accounts/companies/invites/anomaly reviews
- Observability: CloudWatch logs, dashboard, alarms, SNS topic

## Testing Coverage

Python unit tests exist for:

- transform lambda
- ml inference lambda
- anomaly lambda
- live api lambda

Terraform also includes a `terraform test` fixture under `smartstream-terraform/tests/`.

## Known Operational Notes

- CloudFront distribution is defined but currently disabled by default.
- Transform, ML, and anomaly outputs are tenant-scoped by deployment/company ID.
- In this workspace, tenant data is expected under `trusted/smartstream-dev/...` and `trusted-analytics/smartstream-dev/...`.
- Legacy shared-prefix objects may still exist from earlier runs and can be backfilled or ignored once tenant prefixes are populated.

## CI/CD

`Jenkinsfile` provides parameterized `plan/apply/destroy` flow for `legacy` or `tenant` target, including workspace normalization and manual approval for apply/destroy.

## Primary Documentation

- `README.md` (repo root)
- `frontend/README.md`
- `smartstream-terraform/README.md`
- `smartstream-terraform/DEPLOYMENT_CHECKLIST.md`
- `smartstream-terraform/QUICK_REFERENCE.md`
- `smartstream-terraform/IAM_PERMISSIONS.md`
