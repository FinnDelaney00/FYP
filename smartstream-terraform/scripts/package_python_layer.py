import argparse
import platform
import shutil
import subprocess
import sys
from pathlib import Path


"""
Packages such as numpy expose runtime modules under test-related package names
(for example, ``numpy.testing`` and ``numpy._core.tests``), so we preserve
those package trees while still stripping obvious non-runtime directories from
other dependencies.
"""

STRIP_DIR_NAMES = {
    "__pycache__",
    ".pytest_cache",
    "benchmarks",
    "doc",
    "docs",
    "examples",
    "test",
    "testing",
    "tests",
}
STRIP_SUFFIXES = (".dist-info", ".egg-info")
DELETE_FILE_SUFFIXES = (".pyc", ".pyo")
DEFAULT_LAMBDA_PLATFORM = "manylinux2014_x86_64"
DEFAULT_LAMBDA_IMPLEMENTATION = "cp"
DEFAULT_LAMBDA_PYTHON_VERSION = "3.11"
NUMPY_RUNTIME_TEST_DIR_NAMES = {"test", "testing", "tests"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a Python Lambda layer with stripped dependencies.")
    parser.add_argument("--requirements", required=True, help="Path to requirements.txt")
    parser.add_argument("--output-dir", required=True, help="Layer output directory")
    parser.add_argument(
        "--platform",
        default=DEFAULT_LAMBDA_PLATFORM,
        help=f"Target wheel platform for non-Linux hosts (default: {DEFAULT_LAMBDA_PLATFORM})",
    )
    parser.add_argument(
        "--implementation",
        default=DEFAULT_LAMBDA_IMPLEMENTATION,
        help=f"Target Python implementation for non-Linux hosts (default: {DEFAULT_LAMBDA_IMPLEMENTATION})",
    )
    parser.add_argument(
        "--python-version",
        default=DEFAULT_LAMBDA_PYTHON_VERSION,
        help=f"Target Lambda Python version for non-Linux hosts (default: {DEFAULT_LAMBDA_PYTHON_VERSION})",
    )
    return parser.parse_args()


def remove_existing(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)


def install_requirements(
    requirements_path: Path,
    target_dir: Path,
    *,
    target_platform: str,
    target_implementation: str,
    target_python_version: str,
) -> None:
    command = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--upgrade",
        "--no-compile",
        "--requirement",
        str(requirements_path),
        "--target",
        str(target_dir),
    ]

    if platform.system().lower() != "linux":
        command.extend(
            [
                "--platform",
                target_platform,
                "--implementation",
                target_implementation,
                "--python-version",
                target_python_version,
                "--only-binary",
                ":all:",
            ]
        )

    try:
        subprocess.run(command, check=True)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(
            (
                "Failed to install Lambda layer dependencies. "
                f"requirements={requirements_path} "
                f"target_platform={target_platform} "
                f"target_python_version={target_python_version} "
                f"target_implementation={target_implementation}. "
                "If pip reports a pinned package cannot be found, use a nearby Lambda-compatible version."
            )
        ) from exc


def should_preserve_dir(root: Path, path: Path) -> bool:
    if path.name not in NUMPY_RUNTIME_TEST_DIR_NAMES:
        return False

    try:
        relative = path.relative_to(root)
    except ValueError:
        return False

    return bool(relative.parts) and relative.parts[0] == "numpy"


def strip_package_tree(root: Path) -> None:
    for path in sorted(root.rglob("*"), key=lambda item: len(item.parts), reverse=True):
        if path.is_dir():
            if should_preserve_dir(root, path):
                continue
            if path.name in STRIP_DIR_NAMES or path.name.endswith(STRIP_SUFFIXES):
                shutil.rmtree(path, ignore_errors=True)
        elif path.is_file() and path.suffix in DELETE_FILE_SUFFIXES:
            path.unlink(missing_ok=True)


def main() -> int:
    args = parse_args()
    requirements_path = Path(args.requirements).resolve()
    output_dir = Path(args.output_dir).resolve()
    python_dir = output_dir / "python"

    remove_existing(output_dir)
    python_dir.mkdir(parents=True, exist_ok=True)

    install_requirements(
        requirements_path,
        python_dir,
        target_platform=args.platform,
        target_implementation=args.implementation,
        target_python_version=args.python_version,
    )
    strip_package_tree(python_dir)

    print(f"Built Python layer at {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
