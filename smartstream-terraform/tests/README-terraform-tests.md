# Terraform Tests Guide

This folder contains Terraform-native test definitions used by `terraform test`.

## Files

| File | Purpose |
| --- | --- |
| `pipeline_integration.tftest.hcl` | Verifies important infrastructure wiring and override behavior |
| `validation_guardrails.tftest.hcl` | Confirms selected invalid variable values fail as expected |

## What `pipeline_integration.tftest.hcl` Covers

The plan-level integration test checks things such as:

- DMS source endpoint is PostgreSQL
- DMS target endpoint is Kinesis
- Firehose still delivers to the raw zone
- S3 notification prefix matches the transform Lambda raw prefix
- transform, ML, live API, and ops API environment variables stay aligned with locals and outputs
- finance schema/table overrides are honored
- tenant mode reuses shared IAM roles instead of creating tenant-specific copies

The test uses Terraform mock providers so it can validate structure without creating real AWS resources.

## What `validation_guardrails.tftest.hcl` Covers

The guardrail test intentionally supplies bad input values and expects the plan to fail for:

- `query_max_rows`
- `ml_forecast_days`
- `auth_token_ttl_seconds`

## How To Run

```powershell
Set-Location smartstream-terraform
terraform init -backend=false
terraform test
```

You can also combine this with format and validation:

```powershell
terraform fmt -check *.tf tests/*.tftest.hcl
terraform validate
terraform test
```

## Why This Folder Matters

These tests are the fastest way to catch infrastructure regressions that are not obvious from reading a large Terraform plan by eye.

They are especially useful when:

- refactoring resource names
- changing Lambda environment variable wiring
- editing tenant-mode behavior
- changing finance schema/table configuration
