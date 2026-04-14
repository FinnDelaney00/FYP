"""Pytest fixtures shared across the repository test suite."""

import shutil
import uuid
from pathlib import Path

import pytest


TMP_ROOT = Path(__file__).resolve().parent / "artifacts" / "tmp"


@pytest.fixture
def tmp_path():
    """Create a deterministic temporary directory under ``tests/artifacts``.

    The repository keeps certain packaging tests close to fixture output so the
    generated trees are easy to inspect when a test fails locally.
    """

    TMP_ROOT.mkdir(exist_ok=True)
    path = TMP_ROOT / f"pytest-{uuid.uuid4().hex}"
    path.mkdir(parents=True, exist_ok=False)
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)
