"""Hermes tool schemas and hardened UNIFY Gateway client."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

_MAX_RESPONSE_BYTES = 4 * 1024 * 1024
_TIMEOUT_SECONDS = 12
_ALLOWED_HTTP_HOSTS = {"127.0.0.1", "localhost", "unify-core"}


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = build_opener(_NoRedirect)


def _config() -> tuple[str, str]:
    raw_url = os.environ.get("UNIFY_MEMORY_GATEWAY_URL", "").strip()
    token_file = os.environ.get("UNIFY_MEMORY_TOKEN_BUNDLE_FILE", "").strip()
    parsed = urlsplit(raw_url)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or (parsed.scheme == "http" and parsed.hostname not in _ALLOWED_HTTP_HOSTS)
    ):
        raise RuntimeError("UNIFY memory gateway URL is not a permitted origin")
    if not token_file:
        raise RuntimeError("UNIFY memory token bundle is not configured")
    try:
        value = json.loads(Path(token_file).read_text(encoding="utf-8"))
        token = value["active"]["token"]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise RuntimeError("UNIFY memory service authentication is unavailable") from exc
    if not isinstance(token, str) or not 16 <= len(token) <= 4096 or any(ord(c) < 33 for c in token):
        raise RuntimeError("UNIFY memory service authentication is invalid")
    return raw_url.rstrip("/"), token


def is_available() -> bool:
    try:
        _config()
        return True
    except RuntimeError:
        return False


def _idempotency(tool: str, args: dict[str, Any]) -> str:
    material = json.dumps(
        {"tool": tool, "operation_id": args.get("operation_id"), "arguments": args},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    return f"hermes-{hashlib.sha256(material).hexdigest()}"


def _call(endpoint: str, payload: dict[str, Any], *, idempotency_key: str | None = None) -> str:
    try:
        base_url, token = _config()
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        headers = {
            "accept": "application/json",
            "authorization": f"Bearer {token}",
            "content-type": "application/json",
            "user-agent": "unify-memory-hermes-plugin/1.0.0",
        }
        if idempotency_key:
            headers["idempotency-key"] = idempotency_key
        request = Request(f"{base_url}/api/v1/framework-tools/memory/{endpoint}", data=body, headers=headers, method="POST")
        with _OPENER.open(request, timeout=_TIMEOUT_SECONDS) as response:
            if response.headers.get_content_type() != "application/json":
                raise RuntimeError("UNIFY memory response was not JSON")
            if response.headers.get("x-memoryv4-contract-version") != "1.0.0":
                raise RuntimeError("UNIFY memory contract version did not match")
            raw = response.read(_MAX_RESPONSE_BYTES + 1)
            if len(raw) > _MAX_RESPONSE_BYTES:
                raise RuntimeError("UNIFY memory response exceeded the safety limit")
            value = json.loads(raw.decode("utf-8"))
            return json.dumps({"success": True, "data": value}, ensure_ascii=False)
    except HTTPError as exc:
        raw = exc.read(64 * 1024)
        try:
            value = json.loads(raw.decode("utf-8"))
            error = value.get("error", {}) if isinstance(value, dict) else {}
            code = str(error.get("code") or "UNIFY_MEMORY_REQUEST_FAILED")
            message = str(error.get("message") or "UNIFY memory request failed")
        except (ValueError, UnicodeDecodeError):
            code, message = "UNIFY_MEMORY_REQUEST_FAILED", "UNIFY memory request failed"
        return json.dumps({"success": False, "error": {"code": code[:100], "message": message[:500], "status": exc.code}})
    except (URLError, TimeoutError, OSError, RuntimeError, ValueError) as exc:
        return json.dumps({"success": False, "error": {"code": "UNIFY_MEMORY_UNAVAILABLE", "message": str(exc)[:500]}})


def _clean(args: dict[str, Any], *excluded: str) -> dict[str, Any]:
    return {key: value for key, value in args.items() if key not in excluded and value is not None}


def handle_search(args: dict[str, Any], **_: Any) -> str:
    return _call("search", _clean(args))


def handle_context(args: dict[str, Any], **_: Any) -> str:
    return _call("context", _clean(args))


def handle_get(args: dict[str, Any], **_: Any) -> str:
    return _call("get", _clean(args))


def handle_remember(args: dict[str, Any], **_: Any) -> str:
    payload = _clean(args, "operation_id")
    return _call("remember", payload, idempotency_key=_idempotency("remember", args))


def handle_update(args: dict[str, Any], **_: Any) -> str:
    payload = _clean(args, "operation_id")
    return _call("update", payload, idempotency_key=_idempotency("update", args))


SCOPE = {
    "type": "string",
    "maxLength": 1000,
    "description": "Optional descendant scope such as org:aquiero/project:alpha.",
}
LIMIT = {"type": "integer", "minimum": 1, "maximum": 100}
ENTITY = {
    "type": "object",
    "additionalProperties": False,
    "properties": {"entity_type": {"type": "string"}, "id": {"type": "string"}},
    "required": ["entity_type", "id"],
}
RECORD_FIELDS = {
    "title": {"type": "string", "maxLength": 240},
    "content": {"type": "string", "maxLength": 1_000_000},
    "entity": ENTITY,
    "topic": {"type": "string", "maxLength": 240},
    "tags": {"type": "array", "items": {"type": "string"}, "maxItems": 50},
    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
    "source_refs": {
        "type": "array",
        "items": {"type": "string", "maxLength": 2048},
        "maxItems": 100,
    },
    "provenance": {"type": "object"},
    "attrs": {"type": "object"},
}
OPERATION_ID = {
    "type": "string",
    "description": "Stable caller operation identifier. Reuse it for retries; change it for an intentional duplicate.",
}

SEARCH_SCHEMA = {
    "name": "unify_memory_search",
    "description": "Search governed organizational memory. Use before relying on recollection for project or team facts.",
    "parameters": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "q": {"type": "string", "maxLength": 500},
            "scope_path": SCOPE,
            "include_public": {"type": "boolean"},
            "role": {"type": "string", "enum": ["canonical", "active", "evidence", "exhaust"]},
            "lifecycle": {"type": "string", "enum": ["live", "working", "archived", "expired"]},
            "entity_type": {"type": "string"},
            "entity_id": {"type": "string"},
            "tag": {"type": "string"},
            "limit": LIMIT,
            "cursor": {"type": "string"},
        },
        "required": ["q"],
    },
}
CONTEXT_SCHEMA = {
    "name": "unify_memory_context",
    "description": "Retrieve governed records, relations, and artifacts attached to one entity.",
    "parameters": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "entity_type": {"type": "string"},
            "entity_id": {"type": "string"},
            "scope_path": SCOPE,
            "include_public": {"type": "boolean"},
            "limit": LIMIT,
        },
        "required": ["entity_type", "entity_id"],
    },
}
GET_SCHEMA = {
    "name": "unify_memory_get",
    "description": "Fetch one governed memory record by ID, including its current version for safe updates.",
    "parameters": {
        "type": "object",
        "additionalProperties": False,
        "properties": {"record_id": {"type": "string"}, "scope_path": SCOPE},
        "required": ["record_id"],
    },
}
REMEMBER_SCHEMA = {
    "name": "unify_memory_remember",
    "description": "Create an author-only active record in working lifecycle. This cannot create canonical memory or promote records.",
    "parameters": {
        "type": "object",
        "additionalProperties": False,
        "properties": {**RECORD_FIELDS, "scope_path": SCOPE, "operation_id": OPERATION_ID},
        "required": ["title", "content", "operation_id"],
    },
}
UPDATE_SCHEMA = {
    "name": "unify_memory_update",
    "description": "Optimistically update a framework-authored working record. Supply the version returned by get/search.",
    "parameters": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "record_id": {"type": "string"},
            "expected_version": {"type": "integer", "minimum": 1},
            "reason": {"type": "string", "maxLength": 500},
            "patch": {"type": "object", "additionalProperties": False, "properties": RECORD_FIELDS, "minProperties": 1},
            "operation_id": OPERATION_ID,
        },
        "required": ["record_id", "expected_version", "patch", "operation_id"],
    },
}

TOOLS = (
    ("unify_memory_search", SEARCH_SCHEMA, handle_search, "🔎"),
    ("unify_memory_context", CONTEXT_SCHEMA, handle_context, "🧠"),
    ("unify_memory_get", GET_SCHEMA, handle_get, "📖"),
    ("unify_memory_remember", REMEMBER_SCHEMA, handle_remember, "✍️"),
    ("unify_memory_update", UPDATE_SCHEMA, handle_update, "🛠️"),
)
