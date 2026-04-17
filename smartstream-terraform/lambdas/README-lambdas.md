# Lambda Folder Guide

This folder contains all SmartStream serverless application code. Each subfolder maps to a Lambda function packaged by Terraform.

## Lambda Overview

| Folder | Trigger style | Main job | Runtime |
| --- | --- | --- | --- |
| `transform/` | S3 object-created events | Convert raw CDC objects into trusted-zone records | Python 3.11 |
| `ml/` | EventBridge schedule | Train and publish forecast outputs | Python 3.11 |
| `anomaly/` | EventBridge schedule | Detect finance anomalies and publish anomaly outputs | Python 3.11 |
| `live_api/` | API Gateway HTTP API | Business app auth, dashboard, forecasts, anomalies, query | Python 3.12 |
| `ops_api/` | API Gateway HTTP API | Monitoring snapshot and pipeline health endpoints | Python 3.12 |

## Folder-by-Folder Notes

### `transform/`

Main responsibilities:

- read raw Firehose-delivered CDC files
- handle gzip and plain JSON input
- filter DMS control records like `awsdms_*`
- route employee and finance rows separately
- standardize timestamp fields
- remove empty fields and duplicates
- write JSON lines into the trusted zone

Typical output shape:

- `trusted/<tenant-prefix>/employees/...`
- `trusted/<tenant-prefix>/finance/transactions/...`

### `ml/`

Main responsibilities:

- read recent trusted employee and finance objects
- build daily time series
- train forecasting models using `RandomForestRegressor`
- generate headcount, revenue, and expenditure forecasts
- include diagnostics and metadata in the output payload
- write prediction documents to the trusted analytics zone

### `anomaly/`

Main responsibilities:

- read recent trusted finance transactions
- normalize amounts and timestamps
- build anomaly feature frames
- score records with `IsolationForest`
- generate human-readable anomaly documents with severity, reasons, metrics, and details
- write anomaly outputs to the trusted analytics zone

### `live_api/`

Main responsibilities:

- lightweight account signup/login
- signed token issuance and verification
- tenant-aware data path resolution
- dashboard and forecast payload shaping
- anomaly listing, detail retrieval, and review-action updates
- admin invite creation
- safe query execution over Athena

Backing services used by this Lambda:

- S3
- Athena
- Glue
- DynamoDB tables for accounts, companies, invites, and anomaly reviews

### `ops_api/`

Main responsibilities:

- build a normalized ops snapshot from AWS service signals
- expose overview, pipeline list, pipeline detail, alarms, and log-summary routes
- optionally enforce auth and minimum role checks
- add metadata describing whether the snapshot is live or partial

Supporting modules:

- `auth_utils.py`
- `health_model.py`

## Local Testing Relationship

These folders are heavily exercised by the root `tests/` suite. The tests use fake AWS clients/resources so you can validate logic without a live AWS deployment.

Important test files:

- `tests/test_transform_lambda.py`
- `tests/test_ml_inference_lambda.py`
- `tests/test_anomaly_lambda.py`
- `tests/test_live_api_lambda.py`
- `tests/test_ops_api_lambda.py`
- `tests/test_backend_integration.py`

## Packaging Notes

- Terraform zips each Lambda folder using the `archive` provider.
- ML and anomaly Lambdas also attach the shared Python ML dependency layer.
- Generated zip artifacts currently live alongside the source folders in this directory.

## What To Check Before Editing

Before changing a Lambda here, check:

- its Terraform file for environment variables and runtime
- the relevant tests in `../tests/`
- any S3 prefix assumptions used by downstream consumers
- whether the output contract is consumed by a frontend page or another Lambda
