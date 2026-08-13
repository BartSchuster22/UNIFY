#!/usr/bin/env python3
"""Production Phase 8 provider QA against one local Hermes control adapter.

Run inside each Hermes runtime container. The script is intentionally fail-closed:
it never changes credentials or model selection. It exercises all provider contracts,
dry-runs every validation and inference operation, probes stale-version errors, and
attempts inference only for providers Hermes reports configured. Evidence contains
safe metadata only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

FORBIDDEN_KEY = re.compile(r"(?:secret|credential|api[_-]?key|access[_-]?token|refresh[_-]?token|password|authorization)", re.I)
SOURCE_VERSION = re.compile(r"^sha256:[0-9a-f]{64}$")


def read_text(path: str) -> str:
    return Path(path).read_text(encoding="utf-8").strip()


def safe_shape(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: safe_shape(item) for key, item in value.items() if not FORBIDDEN_KEY.search(key)}
    if isinstance(value, list):
        return [safe_shape(item) for item in value]
    if isinstance(value, str):
        return value[:500]
    return value


class Adapter:
    def __init__(self, origin: str, token: str, secret_values: list[str]):
        self.origin = origin.rstrip("/")
        self.token = token
        self.secret_values = [value for value in secret_values if len(value) >= 8]
        self.context = ssl._create_unverified_context()  # loopback-only, private runtime certificate
        self.raw_responses: list[bytes] = []

    def request(self, path: str, method: str = "GET", body: Any | None = None) -> tuple[int, dict[str, Any]]:
        encoded = None if body is None else json.dumps(body, separators=(",", ":")).encode()
        request = urllib.request.Request(
            self.origin + path,
            data=encoded,
            method=method,
            headers={
                "accept": "application/json",
                "authorization": "Bearer " + self.token,
                **({"content-type": "application/json"} if encoded is not None else {}),
            },
        )
        try:
            response = urllib.request.urlopen(request, context=self.context, timeout=180)
            status = response.status
            raw = response.read()
        except urllib.error.HTTPError as error:
            status = error.code
            raw = error.read()
        self.raw_responses.append(raw)
        for secret in self.secret_values:
            if secret.encode() in raw:
                raise AssertionError("A runtime secret appeared in an adapter response")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as error:
            raise AssertionError(f"Adapter returned non-JSON HTTP {status}") from error
        if not isinstance(parsed, dict):
            raise AssertionError("Adapter returned a non-object response")
        return status, parsed


def command(operation: str, target: str, mode: str, payload: dict[str, Any], expected: str | None = None) -> dict[str, Any]:
    value: dict[str, Any] = {
        "operation": operation,
        "targetId": target,
        "mode": mode,
        "idempotencyKey": "phase8-" + uuid.uuid4().hex,
        "requestId": "phase8-" + uuid.uuid4().hex,
        "correlationId": "phase8-production-qa",
        "actor": {"type": "service", "id": "phase8-production-qa"},
        "payload": payload,
    }
    if expected:
        value["expectedSourceVersion"] = expected
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--origin", default="https://127.0.0.1:28082")
    parser.add_argument("--token-bundle", default="/run/secrets/adapter-token-bundle")
    parser.add_argument("--api-token", default="/run/secrets/hermes-api-token")
    parser.add_argument("--database-url", default="/run/secrets/database-url")
    parser.add_argument("--output", required=True)
    parser.add_argument("--execute-configured-inference", action="store_true")
    args = parser.parse_args()

    bundle = json.loads(read_text(args.token_bundle))
    adapter_token = bundle["active"]["token"]
    secret_values = [adapter_token]
    for path in (args.api_token, args.database_url):
        if Path(path).is_file():
            secret_values.append(read_text(path))
    api = Adapter(args.origin, adapter_token, secret_values)

    started = time.time()
    status, inventory = api.request("/control/v1/providers?limit=100")
    assert status == 200, inventory
    framework = inventory["frameworkId"]
    providers = inventory["data"]["items"]
    source_version = inventory["sourceVersion"]
    assert SOURCE_VERSION.match(source_version)
    assert len(providers) == 42, f"expected 42 providers, got {len(providers)}"
    ids = [item["id"] for item in providers]
    assert len(set(ids)) == 42

    status, models_response = api.request("/control/v1/models?limit=100")
    assert status == 200
    models = models_response["data"]["items"]
    by_provider: dict[str, list[str]] = {}
    for model in models:
        by_provider.setdefault(model["providerId"], []).append(model["id"])

    rows: list[dict[str, Any]] = []
    for provider in providers:
        provider_id = provider["id"]
        serialized_contract = json.dumps(provider, separators=(",", ":"))
        for secret in secret_values:
            assert secret not in serialized_contract
        setup_fields = provider.get("setupFields") or []
        for setup_field in setup_fields:
            assert "value" not in setup_field
            if setup_field.get("secret"):
                assert setup_field.get("type") in ("secret", "secret_file")

        dry_runs: dict[str, int] = {}
        disconnect_operation = (
            "provider.oauth.disconnect"
            if str(provider.get("authMethod", "")).startswith("oauth_")
            else "provider.credential.remove"
        )
        for operation, payload in (
            ("provider.validate", {}),
            ("provider.models.refresh", {}),
            ("provider.inference.test", {"modelId": (by_provider.get(provider_id) or ["phase8-unavailable"])[0]}),
            (disconnect_operation, {}),
        ):
            code, response = api.request(
                "/control/v1/commands/models",
                "POST",
                command(
                    operation,
                    provider_id,
                    "dry-run",
                    payload,
                    models_response["sourceVersion"]
                    if operation in ("provider.models.refresh", "provider.inference.test")
                    else source_version,
                ),
            )
            assert code == 200, (provider_id, operation, response)
            assert response["data"]["status"] == "dry-run"
            dry_runs[operation] = code

        stale_code, stale = api.request(
            "/control/v1/commands/models",
            "POST",
            command("provider.validate", provider_id, "execute", {}, "sha256:" + "0" * 64),
        )
        assert stale_code == 409, (provider_id, stale_code, stale)
        assert stale.get("error", {}).get("code") == "source_version_mismatch"

        inference: dict[str, Any] = {"status": "blocked", "reason": "provider_not_configured"}
        configured = provider.get("credentialStatus") == "configured"
        if configured and args.execute_configured_inference:
            model_id = (by_provider.get(provider_id) or ["phase8-unavailable"])[0]
            code, response = api.request(
                "/control/v1/commands/models",
                "POST",
                command("provider.inference.test", provider_id, "execute", {"modelId": model_id}, models_response["sourceVersion"]),
            )
            result = response.get("data", {}).get("result", {})
            inference = {
                "status": "passed" if code == 200 and result.get("succeeded") is True else "failed",
                "httpStatus": code,
                "modelId": model_id,
                **({"errorCode": response.get("error", {}).get("code")} if code != 200 else {}),
            }

        rows.append(
            {
                "providerId": provider_id,
                "authMethod": provider.get("authMethod"),
                "credentialStatus": provider.get("credentialStatus"),
                "connectionState": provider.get("connectionState"),
                "deploymentReadiness": provider.get("deploymentReadiness"),
                "modelCount": len(by_provider.get(provider_id, [])),
                "contractRedaction": "passed",
                "dryRuns": dry_runs,
                "staleSourceError": "passed",
                "inference": inference,
            }
        )

    status, after = api.request("/control/v1/providers?limit=100")
    assert status == 200
    after_items = after["data"]["items"]
    immutable_projection = lambda items: [
        (item["id"], item.get("credentialStatus"), item.get("selected")) for item in items
    ]
    assert immutable_projection(after_items) == immutable_projection(providers)

    raw_digest = hashlib.sha256(b"\n".join(api.raw_responses)).hexdigest()
    report = {
        "schemaVersion": "unify-provider-production-qa/v1",
        "frameworkId": framework,
        "startedAtEpoch": int(started),
        "durationMs": int((time.time() - started) * 1000),
        "providerCount": len(rows),
        "configuredProviders": [row["providerId"] for row in rows if row["credentialStatus"] == "configured"],
        "selectedProviders": [item["id"] for item in providers if item.get("selected")],
        "checks": {
            "inventory": "passed",
            "uniqueContracts": "passed",
            "responseSecretRedaction": "passed",
            "dryRunCoverage": len(rows) * 4,
            "staleSourceErrors": len(rows),
            "stateUnchanged": "passed",
        },
        "rawResponseDigest": "sha256:" + raw_digest,
        "providers": rows,
    }
    rendered = json.dumps(report, indent=2) + "\n"
    for secret in secret_values:
        if secret in rendered:
            raise AssertionError("A runtime secret appeared in the QA evidence")
    if args.output == "-":
        print(rendered, end="")
    else:
        Path(args.output).write_text(rendered, encoding="utf-8")
        print(json.dumps({"frameworkId": framework, "providerCount": len(rows), "checks": report["checks"]}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"phase8_provider_qa=failed error={type(error).__name__}:{error}", file=sys.stderr)
        raise
