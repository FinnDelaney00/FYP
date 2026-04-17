import base64
import hashlib
import hmac
import json
import os
import re
import time
from typing import Any, Dict, Optional

import boto3


# The ops API reuses these helpers to validate bearer tokens and confirm the caller still
# has a live account and company in DynamoDB.
class ForbiddenError(Exception):
    pass


dynamodb = boto3.resource("dynamodb")

# Resolve table names and auth settings once when the Lambda starts.
ACCOUNTS_TABLE_NAME = os.environ.get("ACCOUNTS_TABLE", "").strip()
COMPANIES_TABLE_NAME = os.environ.get("COMPANIES_TABLE", "").strip()
AUTH_TOKEN_SECRET = os.environ.get("AUTH_TOKEN_SECRET", "dev-secret-change-me")
DEFAULT_ACCOUNT_ROLE = str(os.environ.get("DEFAULT_ACCOUNT_ROLE", "member") or "member").strip().lower() or "member"

accounts_table = dynamodb.Table(ACCOUNTS_TABLE_NAME) if ACCOUNTS_TABLE_NAME else None
companies_table = dynamodb.Table(COMPANIES_TABLE_NAME) if COMPANIES_TABLE_NAME else None

EMAIL_PATTERN = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
COMPANY_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{1,62}$")
ALLOWED_ACCOUNT_ROLES = {"viewer", "member", "analyst", "admin"}
ACTIVE_STATUS_VALUES = {"active"}
ROLE_ORDER = {
    "viewer": 0,
    "member": 1,
    "analyst": 2,
    "admin": 3,
}


if DEFAULT_ACCOUNT_ROLE not in ALLOWED_ACCOUNT_ROLES or DEFAULT_ACCOUNT_ROLE == "admin":
    DEFAULT_ACCOUNT_ROLE = "member"


# Validate the signed token first, then compare it with the latest account and company state
# in DynamoDB so stale or revoked access is caught server-side.
def build_auth_context(
    event: Dict[str, Any],
    *,
    require_auth: bool,
    required_role: str = "admin",
) -> Optional[Dict[str, Any]]:
    auth_header = _get_header(event, "Authorization")
    required_role_normalized = _normalize_role(required_role, fallback="admin")

    if not auth_header:
        if require_auth:
            raise PermissionError("Missing Authorization header.")
        return None

    parts = auth_header.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise PermissionError("Authorization header must be Bearer token.")

    token = parts[1].strip()
    if not token:
        raise PermissionError("Missing bearer token.")

    claims = _verify_token(token)
    email = _validate_email(str(claims.get("sub") or ""))
    role_from_token = _normalize_role(claims.get("role"), fallback=DEFAULT_ACCOUNT_ROLE)
    company_id_from_token = _normalize_company_id(claims.get("company_id"))

    account = _get_account(email)
    company = _get_company(company_id_from_token)
    role = role_from_token

    if account:
        if not _is_active_status(account.get("status")):
            raise ForbiddenError("Account is inactive.")

        account_company_id = _normalize_company_id(account.get("company_id"))
        if account_company_id != company_id_from_token:
            raise PermissionError("Auth token is stale. Please sign in again.")

        role = _normalize_role(account.get("role"), fallback=DEFAULT_ACCOUNT_ROLE)
        if role != role_from_token:
            raise PermissionError("Auth token is stale. Please sign in again.")

    if company and not _is_active_status(company.get("status")):
        raise ForbiddenError("Company is inactive.")

    if require_auth and not role_meets_required(role, required_role_normalized):
        raise ForbiddenError(f"{required_role_normalized.capitalize()} role required.")

    return {
        "claims": claims,
        "email": email,
        "role": role,
        "company_id": company_id_from_token,
        "account": account,
        "company": company,
    }


# The helpers below are split by responsibility: role checks, DynamoDB lookups, header and
# token parsing, and a final set of small input normalizers.
def role_meets_required(role: str, required_role: str) -> bool:
    normalized_role = _normalize_role(role)
    normalized_required = _normalize_role(required_role, fallback="admin")
    return ROLE_ORDER.get(normalized_role, 0) >= ROLE_ORDER.get(normalized_required, 3)


def _get_account(email: str) -> Optional[Dict[str, Any]]:
    if accounts_table is None:
        return None
    response = accounts_table.get_item(Key={"email": email})
    item = response.get("Item")
    return item if isinstance(item, dict) else None


def _get_company(company_id: str) -> Optional[Dict[str, Any]]:
    if companies_table is None:
        return None
    response = companies_table.get_item(Key={"company_id": company_id})
    item = response.get("Item")
    return item if isinstance(item, dict) else None


def _get_header(event: Dict[str, Any], header_name: str) -> Optional[str]:
    headers = event.get("headers") or {}
    target = header_name.lower()

    for key, value in headers.items():
        if str(key).lower() == target:
            return value

    return None


def _verify_token(token: str) -> Dict[str, Any]:
    if "." not in token:
        raise PermissionError("Invalid auth token.")

    payload_segment, signature_segment = token.split(".", 1)
    expected_signature = _sign_token_segment(payload_segment)
    if not hmac.compare_digest(signature_segment, expected_signature):
        raise PermissionError("Invalid auth token signature.")

    try:
        payload = json.loads(_base64url_decode(payload_segment).decode("utf-8"))
    except Exception as exc:
        raise PermissionError("Invalid auth token payload.") from exc

    if int(payload.get("exp", 0)) < int(time.time()):
        raise PermissionError("Auth token expired.")

    return payload


def _sign_token_segment(segment: str) -> str:
    signature = hmac.new(AUTH_TOKEN_SECRET.encode("utf-8"), segment.encode("utf-8"), hashlib.sha256).digest()
    return _base64url_encode(signature)


def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("utf-8").rstrip("=")


def _base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


# Keep role, email, company, and status values in a predictable format before permission
# checks depend on them.
def _normalize_role(value: Any, *, fallback: str = DEFAULT_ACCOUNT_ROLE) -> str:
    role = str(value or "").strip().lower()
    if role not in ALLOWED_ACCOUNT_ROLES:
        role = fallback
    return role


def _validate_email(email: str) -> str:
    normalized = email.strip().lower()
    if not EMAIL_PATTERN.match(normalized):
        raise PermissionError("Invalid auth token subject.")
    return normalized


def _normalize_company_id(value: Any) -> str:
    company_id = str(value or "").strip().lower()
    if not COMPANY_ID_PATTERN.match(company_id):
        raise PermissionError("Invalid auth token company.")
    return company_id


def _is_active_status(value: Any) -> bool:
    normalized = str(value or "active").strip().lower()
    return normalized in ACTIVE_STATUS_VALUES
