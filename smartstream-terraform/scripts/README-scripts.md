# Scripts Folder Guide

This folder contains helper scripts used by the Terraform deployment flow.

## Current Script

| Script | Purpose |
| --- | --- |
| `package_python_layer.py` | Build a stripped Python Lambda layer from `requirements.txt` |

## `package_python_layer.py`

This script:

- creates the target output directory
- installs packages into an AWS Lambda-style `python/` folder
- supports non-Linux hosts by targeting Lambda-compatible wheel settings
- strips obvious non-runtime files and directories to reduce layer size
- preserves certain NumPy runtime package trees that look like test directories but are needed at runtime

## Why The Stripping Logic Matters

Many packaging scripts delete `tests/` or `testing/` directories blindly. This repo does not do that for every package because some NumPy runtime modules live under names that look test-related.

That is why the script:

- removes common unnecessary folders like `docs`, `examples`, `__pycache__`
- preserves NumPy runtime directories when needed

## Example Usage

Terraform runs the script automatically, but the equivalent manual command is:

```powershell
Set-Location smartstream-terraform
python scripts/package_python_layer.py --requirements layers/ml/requirements.txt --output-dir build/ml_layer --platform manylinux2014_x86_64 --implementation cp --python-version 3.11
```

## Inputs And Outputs

Inputs:

- a `requirements.txt` file
- an output directory
- optional target platform, implementation, and Python version

Outputs:

- a ready-to-zip `python/` directory tree under the chosen output directory

## When You Edit This Script

You usually change it when:

- Lambda-compatible wheel resolution changes
- layer size needs tuning
- a dependency upgrade introduces packaging quirks
- local Windows packaging needs to be made more robust
