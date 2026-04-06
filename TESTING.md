# SmartStream Testing Evidence

This document summarises the automated and manual testing approach for the SmartStream final-year project repository. It is intended to support the project report and appendix by showing what is tested automatically, how the tests are run, and which behaviours still require live AWS validation.

## 1. Testing Strategy

SmartStream uses a mixed testing approach:

- Fast local automated tests for backend logic, API contracts, UI behaviour, and Terraform checks.
- Mocked AWS interactions for Lambda and API coverage where live cloud access is not required.
- Lightweight integration tests that exercise important service-to-service workflows inside the repository.
- Manual/live AWS validation for real CDC, cloud resource health, and deployment-specific behaviour that cannot be reproduced credibly with local mocks alone.

The automated suites are designed to be practical for a student project: fast to run, deterministic, and focused on high-value system paths rather than exhaustive browser snapshots or paid cloud deployment requirements.

## 2. Automated Test Suites

| Suite | Tooling | Purpose |
| --- | --- | --- |
| Backend unit and integration tests | `pytest` | Validates Lambda logic, API route behaviour, negative paths, tenant scoping, and cross-service workflows using mocked AWS clients/resources. |
| Frontend UI tests | `vitest` + `jsdom` | Validates auth state handling, dashboard rendering, forecast rendering, anomaly UI flows, and empty-state behaviour. |
| Monitor UI tests | `vitest` + `jsdom` | Validates ops API normalization/fallback behaviour and monitor dashboard rendering/drill-down flows. |
| Terraform formatting and validation | `terraform fmt`, `terraform validate` | Confirms tracked Terraform files are formatted correctly and the configuration is structurally valid. |
| Terraform plan-level tests | `terraform test` | Verifies pipeline wiring, override behaviour, tenant/shared-IAM behaviour, and selected variable validation guardrails. |

## 3. How To Run The Tests

### Backend

From the repository root:

```powershell
python -m pip install pytest -r smartstream-terraform/layers/ml/requirements.txt
python -m pytest
```

### Frontend dashboard

```powershell
Set-Location frontend
npm ci
npm run lint
npm test
```

### Monitor dashboard

```powershell
Set-Location monitor
npm ci
npm test
```

### Terraform

```powershell
Set-Location smartstream-terraform
$files = @(Get-ChildItem -Name *.tf) + @(Get-ChildItem tests -Name *.tftest.hcl | ForEach-Object { "tests/$_" })
terraform fmt -check $files
terraform init -backend=false
terraform validate
terraform test
```

### Full local verification sequence

```powershell
python -m pytest
Set-Location frontend; npm run lint; npm test; Set-Location ..
Set-Location monitor; npm test; Set-Location ..
Set-Location smartstream-terraform
$files = @(Get-ChildItem -Name *.tf) + @(Get-ChildItem tests -Name *.tftest.hcl | ForEach-Object { "tests/$_" })
terraform fmt -check $files
terraform validate
terraform test
```

## 4. What Is Covered Automatically

### Backend unit coverage

The Python suite covers:

- Transform Lambda record routing, deduplication, timestamp normalization, gzip/plain S3 reads, empty events, and corrupted gzip payload handling.
- ML Lambda parsing, date/boolean normalization, forecast feature generation, insufficient-data handling, corrupted-object tolerance, no-input behaviour, and invalid environment configuration.
- Anomaly Lambda anomaly-frame generation, transaction/daily fallback logic, insufficient-data handling, corrupted-object tolerance, finance-prefix fallback, and invalid environment configuration.
- Live API auth/signup/login flows, invite lifecycle, tenant scoping, query validation, dashboard/forecast routes, anomaly list/detail/action routes, malformed JSON requests, and mocked Athena failure handling.
- Ops API overview/pipelines/alarms/log-summary normalization, partial-data signalling, auth-required behaviour, role enforcement, and method restrictions.

### Backend integration coverage

The repository now includes integration-style backend tests that verify:

- `raw/` input -> Transform Lambda -> trusted employee/finance outputs.
- trusted employee/finance outputs -> ML forecast generation -> trusted analytics prediction output.
- trusted finance input -> anomaly detection output -> anomaly review/status update flow through the Live API.
- Auth token -> tenant-scoped Live API access for downstream dashboard and forecast reads.

### Frontend and monitor coverage

The UI suites cover:

- Login/auth session state handling in the frontend auth service.
- Business dashboard rendering with mocked dashboard payloads.
- Forecast page rendering and focus/horizon control behaviour with mocked API responses.
- Anomaly page list/detail/action flows and empty-state handling.
- Monitor ops API live/partial/mock normalization behaviour.
- Monitor dashboard rendering of overview, pipelines, alarms, and pipeline detail drill-down.

### Terraform coverage

The Terraform checks cover:

- Formatting of tracked Terraform files and test definitions.
- `terraform validate` for structural correctness.
- Existing plan-level infrastructure wiring assertions in `smartstream-terraform/tests/pipeline_integration.tftest.hcl`.
- Variable validation guardrail cases in `smartstream-terraform/tests/validation_guardrails.tftest.hcl` for:
  - `query_max_rows`
  - `ml_forecast_days`
  - `auth_token_ttl_seconds`

## 5. Traceability Matrix

| System feature / requirement | Automated evidence |
| --- | --- |
| Raw CDC files are transformed into trusted tenant-partitioned datasets | `tests/test_transform_lambda.py`, `tests/test_backend_integration.py` |
| Forecast generation works from trusted employee and finance data | `tests/test_ml_inference_lambda.py`, `tests/test_backend_integration.py` |
| Finance anomaly detection works from trusted finance data | `tests/test_anomaly_lambda.py`, `tests/test_backend_integration.py` |
| Live API auth and tenant isolation are enforced | `tests/test_live_api_lambda.py` |
| Live API query endpoint blocks unsafe SQL and handles failures | `tests/test_live_api_lambda.py` |
| Anomaly review actions update status/audit state | `tests/test_live_api_lambda.py`, `tests/test_backend_integration.py` |
| Ops API overview/pipelines/alarms/log-summary responses are normalized | `tests/test_ops_api_lambda.py` |
| Frontend login/auth state is handled correctly | `frontend/src/__tests__/authService.test.js` |
| Frontend dashboard renders mocked business data | `frontend/src/__tests__/dashboardModule.test.js` |
| Frontend forecast page renders mocked API data | `frontend/src/__tests__/insightsData.test.js` |
| Frontend anomaly page actions and empty states work | `frontend/src/__tests__/anomaliesData.test.js` |
| Monitor dashboard loads overview/pipelines/alarms and detail drill-down | `monitor/src/__tests__/app.test.js` |
| Monitor ops API fallback/live envelope handling works | `monitor/src/__tests__/opsApi.test.js` |
| Terraform pipeline wiring and tenant/shared-IAM behaviour are checked | `smartstream-terraform/tests/pipeline_integration.tftest.hcl` |
| Terraform variable guardrails reject invalid inputs | `smartstream-terraform/tests/validation_guardrails.tftest.hcl` |

## 6. Manual And Live AWS Validation Still Required

The automated suites provide strong local evidence, but the following behaviours still require deployed-system validation because they depend on real AWS services, deployment timing, or externally managed infrastructure:

- Real PostgreSQL -> DMS -> Kinesis -> Firehose CDC propagation.
- Real S3 object delivery timing, partition freshness, and Glue crawler updates.
- Real Athena permissions, workgroup configuration, and query execution in AWS.
- Real CloudWatch metrics/logs/alarm availability for the Ops API.
- Real browser deployment behaviour through S3/CloudFront hosting.
- Real tenant accounts, invite distribution, and environment-specific secrets/IAM policies.

## 7. Recommended Manual System Tests For The Final Report

These manual tests are suitable to cite in the final report:

1. Insert, update, and delete representative employee/finance rows in PostgreSQL and confirm they appear end-to-end in `raw/`, `trusted/`, and downstream analytics outputs.
2. Confirm a forecast batch is generated in `trusted-analytics/{company_id}/predictions/` and that the forecast becomes visible in the business dashboard.
3. Create a finance outlier scenario and confirm an anomaly appears in `trusted-analytics/{company_id}/anomalies/` and in the frontend anomaly view.
4. Use anomaly review actions in the UI and confirm the status/audit state updates correctly.
5. Validate tenant isolation by signing in with two different company accounts and confirming each account only sees its own trusted data, predictions, and anomalies.
6. Validate the monitor dashboard against live CloudWatch/DMS/S3 signals and confirm overview, pipelines, alarms, and log summary data reflect the deployed environment.

## 8. Known Limits

- Local automated tests use mocked AWS clients/resources and therefore do not prove IAM, networking, or service quotas.
- UI tests focus on high-value flows and state handling rather than exhaustive end-to-end browser automation.
- Terraform tests validate configuration logic and expected plan wiring, but they do not deploy resources.
- Any behaviour that depends on real event timing, managed AWS service health, or production credentials remains a live validation task.
