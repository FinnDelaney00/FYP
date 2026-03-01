import gzip
import importlib.util
import os
import sys
import types
from pathlib import Path
from typing import Any, Dict, Iterable, Optional
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[1]


class FakeStreamingBody:
    def __init__(self, payload: bytes):
        self._payload = payload

    def read(self) -> bytes:
        return self._payload


class FakePaginator:
    def __init__(self, pages: Iterable[Dict[str, Any]]):
        self._pages = list(pages)

    def paginate(self, **kwargs):
        prefix = kwargs.get("Prefix", "")
        for page in self._pages:
            contents = page.get("Contents", [])
            filtered_contents = [obj for obj in contents if str(obj.get("Key", "")).startswith(prefix)]
            filtered_page = dict(page)
            filtered_page["Contents"] = filtered_contents
            yield filtered_page


class FakeS3Client:
    def __init__(self, pages: Optional[Iterable[Dict[str, Any]]] = None, objects: Optional[Dict[str, Any]] = None):
        self.pages = list(pages or [])
        self.objects = dict(objects or {})
        self.put_calls = []

    def get_paginator(self, name: str) -> FakePaginator:
        if name != "list_objects_v2":
            raise ValueError(f"Unsupported paginator: {name}")
        return FakePaginator(self.pages)

    def get_object(self, Bucket: str, Key: str) -> Dict[str, Any]:
        if Key not in self.objects:
            raise KeyError(f"Missing fake object for key: {Key}")

        payload = self.objects[Key]
        if isinstance(payload, str):
            payload = payload.encode("utf-8")
        if not isinstance(payload, (bytes, bytearray)):
            raise TypeError(f"Fake object payload must be bytes or str, got {type(payload).__name__}")

        return {"Body": FakeStreamingBody(bytes(payload))}

    def put_object(self, **kwargs) -> Dict[str, Any]:
        self.put_calls.append(kwargs)
        return {"ETag": "fake-etag"}


def gzip_bytes(text: str) -> bytes:
    return gzip.compress(text.encode("utf-8"))


def load_module(
    *,
    relative_path: str,
    module_name: str,
    fake_s3_client: Optional[FakeS3Client] = None,
    fake_clients: Optional[Dict[str, Any]] = None,
    fake_resources: Optional[Dict[str, Any]] = None,
    env: Optional[Dict[str, str]] = None,
):
    module_path = REPO_ROOT / relative_path
    if not module_path.exists():
        raise FileNotFoundError(f"Module path not found: {module_path}")

    fake_client = fake_s3_client or FakeS3Client()
    boto_clients = {"s3": fake_client}
    if fake_clients:
        boto_clients.update(fake_clients)
    boto_resources = dict(fake_resources or {})
    env_vars = env or {}

    fake_boto3 = types.ModuleType("boto3")

    def client(service_name: str, *_args, **_kwargs):
        if service_name not in boto_clients:
            raise ValueError(f"Unsupported boto3 client: {service_name}")
        return boto_clients[service_name]

    def resource(service_name: str, *_args, **_kwargs):
        if service_name not in boto_resources:
            raise ValueError(f"Unsupported boto3 resource: {service_name}")
        return boto_resources[service_name]

    fake_boto3.client = client
    fake_boto3.resource = resource

    previous_env: Dict[str, Optional[str]] = {}
    for key, value in env_vars.items():
        previous_env[key] = os.environ.get(key)
        os.environ[key] = value

    try:
        spec = importlib.util.spec_from_file_location(module_name, module_path)
        if spec is None or spec.loader is None:
            raise ImportError(f"Could not load spec for {module_path}")

        module = importlib.util.module_from_spec(spec)
        sys.modules.pop(module_name, None)
        with patch.dict(sys.modules, {"boto3": fake_boto3}):
            spec.loader.exec_module(module)
        return module
    finally:
        for key, original in previous_env.items():
            if original is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = original
