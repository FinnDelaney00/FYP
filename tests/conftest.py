import shutil
import uuid
from pathlib import Path

import pytest


TMP_ROOT = Path(__file__).resolve().parent / "artifacts" / "tmp"


@pytest.fixture
def tmp_path():
    TMP_ROOT.mkdir(exist_ok=True)
    path = TMP_ROOT / f"pytest-{uuid.uuid4().hex}"
    path.mkdir(parents=True, exist_ok=False)
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)
