import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional


# Add the packaged Lambda directory to sys.path so sibling modules can be imported reliably.
CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from auth_utils import ForbiddenError, build_auth_context
from health_model import build_ops_snapshot


# Read lightweight API settings once at cold start.
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
OPS_API_REQUIRE_AUTH = str(os.environ.get("OPS_API_REQUIRE_AUTH", "false")).strip().lower() == "true"
OPS_API_REQUIRED_ROLE = str(os.environ.get("OPS_API_REQUIRED_ROLE", "admin") or "admin").strip().lower() or "admin"


# This handler stays intentionally thin: it authenticates once, builds the shared snapshot,
# and then returns the slice requested by the route.
def lambda_handler(event: Dict[str, Any], _context: Optional[Any]):
    method = _event_method(event)
    path = _event_path(event)

    if method == "OPTIONS":
        return {
            "statusCode": 200,
            "headers": _cors_headers(),
            "body": "",
        }

    try:
        # Build the caller context up front so every route sees the same auth decision.
        auth_context = build_auth_context(
            event,
            require_auth=OPS_API_REQUIRE_AUTH,
            required_role=OPS_API_REQUIRED_ROLE,
        )

        if method != "GET":
            return _response(405, {"message": "Method not allowed"})

        snapshot = build_ops_snapshot()
        meta = dict(snapshot["meta"])
        if auth_context:
            meta["authenticated_as"] = auth_context["email"]
            meta["role"] = auth_context["role"]

        # Each GET route exposes a different view over the same live ops snapshot.
        if path == "/ops/overview":
            return _response(200, {"data": snapshot["overview"], "meta": meta})

        if path == "/ops/pipelines":
            return _response(200, {"data": snapshot["pipelines"], "meta": meta})

        pipeline_id = _pipeline_id_from_path(path)
        if pipeline_id:
            detail = snapshot["pipeline_details"].get(pipeline_id)
            if detail is None:
                return _response(404, {"message": f"Pipeline not found: {pipeline_id}"})
            return _response(200, {"data": detail, "meta": meta})

        if path == "/ops/alarms":
            return _response(200, {"data": snapshot["alarms"], "meta": meta})

        if path == "/ops/log-summary":
            return _response(200, {"data": snapshot["log_summary"], "meta": meta})

        return _response(404, {"message": f"Route not found: {path}"})

    except PermissionError as exc:
        return _response(401, {"message": str(exc)})
    except ForbiddenError as exc:
        return _response(403, {"message": str(exc)})
    except ValueError as exc:
        return _response(400, {"message": str(exc)})
    except Exception as exc:
        return _response(500, {"message": f"Internal server error: {exc}"})


# Shared HTTP helpers keep API Gateway input and output handling consistent across routes.
def _cors_headers() -> Dict[str, str]:
    return {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
    }


def _response(status_code: int, body: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            **_cors_headers(),
        },
        "body": json.dumps(body),
    }


def _event_method(event: Dict[str, Any]) -> str:
    return (event.get("requestContext", {}).get("http", {}).get("method") or "GET").upper()


def _event_path(event: Dict[str, Any]) -> str:
    raw_path = event.get("rawPath") or event.get("requestContext", {}).get("http", {}).get("path") or "/ops/overview"
    if not raw_path.startswith("/"):
        return f"/{raw_path}"
    return raw_path


def _pipeline_id_from_path(path: str) -> Optional[str]:
    prefix = "/ops/pipelines/"
    if not path.startswith(prefix):
        return None
    pipeline_id = path[len(prefix):].strip("/")
    return pipeline_id or None
