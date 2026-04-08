from pathlib import Path

from tests.helpers import load_module


def test_strip_package_tree_preserves_numpy_testing_package(tmp_path):
    module = load_module(
        relative_path="smartstream-terraform/scripts/package_python_layer.py",
        module_name="package_python_layer_under_test",
    )

    python_root = tmp_path / "python"
    numpy_testing = python_root / "numpy" / "testing"
    numpy_core_tests = python_root / "numpy" / "_core" / "tests"
    package_tests = python_root / "demo_pkg" / "tests"
    package_testing = python_root / "demo_pkg" / "testing"
    pycache_dir = python_root / "demo_pkg" / "__pycache__"

    numpy_testing.mkdir(parents=True)
    numpy_core_tests.mkdir(parents=True)
    package_tests.mkdir(parents=True)
    package_testing.mkdir(parents=True)
    pycache_dir.mkdir(parents=True)

    (numpy_testing / "__init__.py").write_text("# runtime import path\n", encoding="utf-8")
    (numpy_core_tests / "_natype.py").write_text("pd_NA = object()\n", encoding="utf-8")
    (package_tests / "test_demo.py").write_text("# should be stripped\n", encoding="utf-8")
    (package_testing / "__init__.py").write_text("# should be stripped\n", encoding="utf-8")
    (pycache_dir / "demo.cpython-311.pyc").write_bytes(b"compiled")

    module.strip_package_tree(python_root)

    assert (numpy_testing / "__init__.py").exists()
    assert (numpy_core_tests / "_natype.py").exists()
    assert not package_tests.exists()
    assert not package_testing.exists()
    assert not pycache_dir.exists()
