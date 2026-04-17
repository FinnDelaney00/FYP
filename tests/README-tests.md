# Backend Tests Guide

This folder contains the Python backend test suite for SmartStream. It validates Lambda behavior, tenant scoping, mocked AWS interactions, and integration-style workflows across multiple services.

## What This Test Suite Covers

| File | Focus |
| --- | --- |
| `test_transform_lambda.py` | Raw-to-trusted transformation behavior |
| `test_ml_inference_lambda.py` | Forecast generation and ML edge cases |
| `test_anomaly_lambda.py` | Finance anomaly detection behavior |
| `test_live_api_lambda.py` | Auth, tenant isolation, query safety, anomaly workflow, and API contracts |
| `test_ops_api_lambda.py` | Ops API normalization, health derivation, partial-data handling, and auth enforcement |
| `test_backend_integration.py` | Integration-style workflows across multiple Lambdas |
| `test_package_python_layer.py` | Layer packaging script behavior |
| `test_ml_model_evaluation.py` | Model evaluation support and report generation behavior |

Support files:

| File | Purpose |
| --- | --- |
| `helpers.py` | Shared fake AWS clients/resources and dynamic module loading helpers |
| `conftest.py` | Pytest configuration/fixtures |
| `__init__.py` | Package marker |

## Testing Style

The tests are intentionally practical rather than cloud-heavy.

They rely on:

- fake S3, Athena, Glue, CloudWatch, DMS, and DynamoDB objects
- direct module loading of Lambda source files
- explicit environment variable injection
- integration-style orchestration where one Lambda's output becomes another Lambda's input

This gives the repository strong logic coverage without requiring live AWS resources for every run.

## Integration Coverage

The most important cross-service checks live in `test_backend_integration.py`. Those tests verify flows like:

- raw CDC object -> transform Lambda -> trusted data
- trusted data -> ML Lambda -> prediction output
- trusted finance data -> anomaly Lambda -> anomaly output
- anomaly output -> Live API -> review action state in DynamoDB

## Running The Suite

From the repository root:

```powershell
python -m pip install -r requirements-dev.txt
python -m pytest
```

Pytest configuration lives in the root `pytest.ini`.

There is currently one custom marker:

- `integration` - cross-service workflow and repository-level integration coverage

Run only integration-style tests:

```powershell
python -m pytest -m integration
```

## Artifacts

The `artifacts/` subfolder stores generated evidence and intermediate outputs related to testing and model evaluation. These are useful for reports and debugging, but they are not the primary source of truth for the test logic itself.

## When To Update These Tests

You should expect to update this folder when you:

- change a Lambda output contract
- alter tenant-prefix behavior
- add or remove Live API routes
- change how ops health is normalized
- modify the ML layer packaging flow

If you touch any of those areas without refreshing tests, you are very likely to drift the documented behavior away from the real implementation.
