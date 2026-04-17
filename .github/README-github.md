# GitHub Folder Guide

This folder contains repository automation that runs on GitHub.

## What Is Here

- `workflows/lint.yml` - the main GitHub Actions workflow for linting, tests, and infrastructure checks

## Current Workflow Coverage

The `lint.yml` workflow runs on:

- every push
- every pull request
- manual `workflow_dispatch`

It currently contains these jobs:

| Job | Purpose |
| --- | --- |
| `python-lint` | Runs `ruff check --select F,E9` against the Lambda Python sources |
| `python-tests` | Installs Python test dependencies and runs the backend `pytest` suite |
| `terraform-checks` | Runs `terraform fmt -check`, `terraform validate`, and `terraform test` |
| `frontend` | Installs frontend dependencies, runs ESLint, and runs Vitest |
| `monitor` | Installs monitor dependencies and runs Vitest |

## Why This Folder Matters

If you change:

- Python Lambda code, GitHub Actions will lint and test it
- Terraform files, GitHub Actions will format-check and validate it
- the business frontend, GitHub Actions will lint and test it
- the monitor frontend, GitHub Actions will test it

## Relationship To Jenkins

This repo also contains a root `Jenkinsfile`. The two automation paths serve different purposes:

- GitHub Actions is the cross-platform CI safety net for commits and pull requests.
- Jenkins is a Windows-oriented deployment/planning pipeline that validates parameters, selects workspaces, and runs Terraform plan steps.

## When You Edit This Folder

You usually touch this folder when:

- adding or tightening CI checks
- updating Node or Python versions used in CI
- changing test commands
- expanding the repository's quality gates

If you add a new meaningful app, test suite, or validation step, this folder is one of the first places that should be updated so the new behavior is enforced automatically.
