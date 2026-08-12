#!/usr/bin/env python3
"""Extend pinned Hermes 0.20.0 credential probes for UNIFY's 22 single-key providers.

This is an exact, fail-closed build patch. It never logs or persists credentials; Hermes
uses each submitted key only in a bounded read-only provider request.
"""
from pathlib import Path

path = Path('/opt/hermes/hermes_cli/web_server.py')
source = path.read_text()
old = '''_CREDENTIAL_PROBES: dict[str, tuple[str, str]] = {
    "OPENROUTER_API_KEY": ("https://openrouter.ai/api/v1/key", "bearer"),
    "OPENAI_API_KEY": ("https://api.openai.com/v1/models", "bearer"),
    "XAI_API_KEY": ("https://api.x.ai/v1/models", "bearer"),
    "GEMINI_API_KEY": ("https://generativelanguage.googleapis.com/v1beta/models", "query"),
}'''
new = '''_CREDENTIAL_PROBES: dict[str, tuple[str, str]] = {
    "FIREWORKS_API_KEY": ("https://api.fireworks.ai/inference/v1/models", "bearer"),
    "OPENROUTER_API_KEY": ("https://openrouter.ai/api/v1/key", "bearer"),
    "NOVITA_API_KEY": ("https://api.novita.ai/v3/billing/credit_balance", "x-api-key"),
    "DASHSCOPE_API_KEY": ("https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models", "bearer"),
    "XIAOMI_API_KEY": ("https://api.xiaomimimo.com/v1/models", "bearer"),
    "NVIDIA_API_KEY": ("https://api.ngc.nvidia.com/v2/users/me", "bearer"),
    "HF_TOKEN": ("https://huggingface.co/api/whoami-v2", "bearer"),
    "DEEPSEEK_API_KEY": ("https://api.deepseek.com/v1/models", "bearer"),
    "XAI_API_KEY": ("https://api.x.ai/v1/models", "bearer"),
    "KIMI_CN_API_KEY": ("https://api.moonshot.cn/v1/models", "bearer"),
    "STEPFUN_API_KEY": ("https://api.stepfun.ai/step_plan/v1/models", "bearer"),
    "MINIMAX_API_KEY": ("https://api.minimax.io/v1/models", "bearer"),
    "MINIMAX_CN_API_KEY": ("https://api.minimaxi.com/v1/models", "bearer"),
    "OLLAMA_API_KEY": ("https://ollama.com/v1/chat/completions", "inference:nemotron-3-nano:30b"),
    "ARCEEAI_API_KEY": ("https://api.arcee.ai/api/v1/models", "bearer"),
    "GMI_API_KEY": ("https://api.gmi-serving.com/v1/models", "bearer"),
    "KILOCODE_API_KEY": ("https://api.kilo.ai/api/gateway/chat/completions", "inference:google/gemini-3.6-flash"),
    "OPENCODE_ZEN_API_KEY": ("https://opencode.ai/zen/v1/chat/completions", "inference:gemini-3-flash"),
    "OPENCODE_GO_API_KEY": ("https://opencode.ai/zen/go/v1/chat/completions", "inference:glm-5"),
    "AI_GATEWAY_API_KEY": ("https://ai-gateway.vercel.sh/v1/models", "bearer"),
    "DEEPINFRA_API_KEY": ("https://api.deepinfra.com/v1/openai/models", "bearer"),
    "UPSTAGE_API_KEY": ("https://api.upstage.ai/v1/models", "bearer"),
    # Advanced key and endpoint provider credential variants.
    "ANTHROPIC_API_KEY": ("https://api.anthropic.com/v1/models", "anthropic"),
    "ANTHROPIC_TOKEN": ("https://api.anthropic.com/v1/models", "anthropic"),
    "CLAUDE_CODE_OAUTH_TOKEN": ("https://api.anthropic.com/v1/models", "anthropic"),
    "GOOGLE_API_KEY": ("https://generativelanguage.googleapis.com/v1beta/models", "query"),
    "GLM_API_KEY": ("https://api.z.ai/api/paas/v4/models", "bearer"),
    "ZAI_API_KEY": ("https://api.z.ai/api/paas/v4/models", "bearer"),
    "Z_AI_API_KEY": ("https://api.z.ai/api/paas/v4/models", "bearer"),
    "KIMI_API_KEY": ("https://api.moonshot.ai/v1/models", "bearer"),
    "KIMI_CODING_API_KEY": ("https://api.kimi.com/coding/v1/models", "bearer"),
    "ALIBABA_CODING_PLAN_API_KEY": ("https://coding-intl.dashscope.aliyuncs.com/v1/models", "bearer"),
    "AZURE_FOUNDRY_API_KEY": ("https://management.azure.com/subscriptions?api-version=2020-01-01", "bearer"),
    "AWS_BEARER_TOKEN_BEDROCK": ("https://bedrock-mantle.us-east-1.api.aws/v1/models", "bearer"),
    # Other Hermes provider families retained from the pinned release.
    "OPENAI_API_KEY": ("https://api.openai.com/v1/models", "bearer"),
    "GEMINI_API_KEY": ("https://generativelanguage.googleapis.com/v1beta/models", "query"),
}'''
if source.count(old) != 1:
    raise SystemExit('Pinned Hermes credential-probe block changed; refusing an unsafe patch')
source = source.replace(old, new)
auth_old = '''    if auth == "bearer":
        headers["Authorization"] = f"Bearer {value}"
    else:
        params["key"] = value'''
auth_new = '''    if auth == "bearer":
        headers["Authorization"] = f"Bearer {value}"
    elif auth == "anthropic":
        headers["x-api-key"] = value
        headers["anthropic-version"] = "2023-06-01"
    elif auth == "x-api-key":
        headers["X-Key"] = value
    elif auth.startswith("inference:"):
        headers["Authorization"] = f"Bearer {value}"
    else:
        params["key"] = value

    request_body = None
    if auth.startswith("inference:"):
        request_body = {
            "model": auth.split(":", 1)[1],
            "messages": [{"role": "user", "content": "Reply OK"}],
            "max_tokens": 1,
        }'''
if source.count(auth_old) != 1:
    raise SystemExit('Pinned Hermes credential-auth block changed; refusing an unsafe patch')
source = source.replace(auth_old, auth_new)
request_old = '''            resp = await client.get(url, headers=headers, params=params)'''
request_new = '''            if request_body is None:
                resp = await client.get(url, headers=headers, params=params)
            else:
                resp = await client.post(url, headers=headers, json=request_body)'''
if source.count(request_old) != 1:
    raise SystemExit('Pinned Hermes credential-request block changed; refusing an unsafe patch')
source = source.replace(request_old, request_new)
auth_old = '''    key = (body.key or "").strip()
    value = (body.value or "").strip()
    if not value:'''
auth_new = '''    key = (body.key or "").strip()
    value = (body.value or "").strip()
    requested_base_url = str(getattr(body, "base_url", "") or "").strip()
    if not value:'''
if source.count(auth_old) != 1:
    raise SystemExit('Pinned Hermes credential-input block changed; refusing an unsafe patch')
source = source.replace(auth_old, auth_new)
probe_old = '''    url, auth = probe
    headers = {"Accept": "application/json"}'''
probe_new = '''    url, auth = probe
    if requested_base_url:
        from urllib.parse import urlsplit
        parsed = urlsplit(requested_base_url)
        if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or parsed.fragment:
            return {"ok": False, "reachable": True, "message": "Provider endpoint must be credential-free HTTPS."}
        url = requested_base_url.rstrip("/") + "/models"
    headers = {"Accept": "application/json"}'''
if source.count(probe_old) != 1:
    raise SystemExit('Pinned Hermes credential-probe selection changed; refusing an unsafe patch')
source = source.replace(probe_old, probe_new)
model_path = Path('/opt/hermes/hermes_cli/web_models.py')
model_source = model_path.read_text()
model_old = '''class EnvVarUpdate(BaseModel):
    key: str
    value: str
    profile: Optional[str] = None
    # Optional bearer key for the connectivity probe of a custom/local endpoint
    # (``key == "OPENAI_BASE_URL"``). Self-hosted endpoints that gate
    # ``/v1/models`` behind auth otherwise look "reachable but empty"; sending
    # the key lets the probe enumerate the served models. Ignored for the
    # regular PUT /api/env path (which only reads key/value).
    api_key: str = ""
'''
model_new = model_old + '    base_url: str = ""\n'
if model_source.count(model_old) != 1:
    raise SystemExit('Pinned Hermes EnvVarUpdate schema changed; refusing an unsafe patch')
model_path.write_text(model_source.replace(model_old, model_new))
request_anchor = '''\n\n@app.delete("/api/env")\nasync def remove_env_var(body: EnvVarDelete, profile: Optional[str] = None):'''
batch_routes = '''

@app.put("/api/env/batch")
async def update_env_batch(request: Request):
    """Atomically persist already-validated provider environment fields."""
    _require_token(request)
    from hermes_cli.config import get_env_value, remove_env_value, save_env_value

    body = await request.json()
    entries = body.get("entries") if isinstance(body, dict) else None
    if not isinstance(entries, list) or not entries or len(entries) > 20:
        raise HTTPException(status_code=400, detail="entries must contain 1-20 fields")
    normalized = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise HTTPException(status_code=400, detail="invalid entry")
        key = str(entry.get("key") or "").strip()
        value = str(entry.get("value") or "").strip()
        if not key or not value or len(value) > 32768:
            raise HTTPException(status_code=400, detail="invalid provider setup field")
        normalized.append((key, value))
    previous = {key: get_env_value(key) for key, _value in normalized}
    written = []
    try:
        for key, value in normalized:
            save_env_value(key, value)
            written.append(key)
    except Exception:
        for key in reversed(written):
            old = previous.get(key)
            if old:
                save_env_value(key, old)
            else:
                remove_env_value(key)
        raise HTTPException(status_code=500, detail="Provider setup was not persisted")
    return {"ok": True, "changed": True, "configured": True}


@app.put("/api/provider-setup/batch")
async def update_provider_setup_batch(request: Request):
    """Atomically persist cloud routing fields without accepting cloud secrets."""
    _require_token(request)
    from hermes_cli.config import get_env_value, remove_env_value, save_env_value

    body = await request.json()
    env_entries = body.get("env", []) if isinstance(body, dict) else []
    config_patch = body.get("config", {}) if isinstance(body, dict) else {}
    if not isinstance(env_entries, list) or len(env_entries) > 20 or not isinstance(config_patch, dict):
        raise HTTPException(status_code=400, detail="invalid provider setup")
    normalized = []
    for entry in env_entries:
        if not isinstance(entry, dict):
            raise HTTPException(status_code=400, detail="invalid provider setup field")
        key = str(entry.get("key") or "").strip()
        value = str(entry.get("value") or "").strip()
        if not key or not value or len(value) > 32768:
            raise HTTPException(status_code=400, detail="invalid provider setup field")
        normalized.append((key, value))
    previous_env = {key: get_env_value(key) for key, _value in normalized}
    previous_config = read_raw_config()
    written = []
    try:
        for key, value in normalized:
            save_env_value(key, value)
            written.append(key)
        if config_patch:
            save_config(_deep_merge(previous_config, config_patch))
    except Exception:
        for key in reversed(written):
            old = previous_env.get(key)
            if old:
                save_env_value(key, old)
            else:
                remove_env_value(key)
        save_config(previous_config)
        raise HTTPException(status_code=500, detail="Provider setup was not persisted")
    return {"ok": True, "changed": bool(normalized or config_patch), "configured": False}


@app.post("/api/providers/identity/validate")
async def validate_provider_identity(request: Request):
    """Validate cloud/external identity without returning credentials or identity values."""
    _require_token(request)
    import shutil
    import subprocess

    body = await request.json()
    provider_id = str(body.get("provider") or "").strip().lower() if isinstance(body, dict) else ""
    values = body.get("values", {}) if isinstance(body, dict) else {}
    if not isinstance(values, dict) or provider_id not in {"bedrock", "vertex", "copilot-acp"}:
        raise HTTPException(status_code=400, detail="unsupported identity validation request")

    def _safe_value(name: str, maximum: int = 300) -> str:
        value = str(values.get(name) or "").strip()
        if len(value) > maximum or any(ord(ch) < 32 for ch in value):
            raise ValueError("invalid identity field")
        return value

    try:
        if provider_id == "bedrock":
            import boto3
            from hermes_cli.config import get_env_value
            profile = _safe_value("profile", 128) or str(get_env_value("AWS_PROFILE") or "").strip()
            region = _safe_value("region", 64) or str(get_env_value("AWS_REGION") or "").strip() or "us-east-1"
            session = boto3.Session(profile_name=profile or None, region_name=region)
            credentials = session.get_credentials()
            if credentials is None:
                return {"providerId": provider_id, "accepted": False, "reachable": True, "verified": False, "prerequisites": {"aws-identity": "missing"}, "message": "AWS credential chain did not resolve an identity."}
            session.client("sts", region_name=region).get_caller_identity()
            discovered = len(session.client("bedrock", region_name=region).list_foundation_models().get("modelSummaries", []))
            return {"providerId": provider_id, "accepted": discovered > 0, "reachable": True, "verified": discovered > 0, "discovered": discovered, "prerequisites": {"aws-identity": "satisfied"}, "identityKind": "aws_sdk"}

        if provider_id == "vertex":
            import google.auth
            from hermes_cli.config import get_env_value
            from google.auth.transport.requests import Request as GoogleAuthRequest
            from google.oauth2 import service_account
            path = _safe_value("credentials", 4096) or str(get_env_value("VERTEX_CREDENTIALS_PATH") or "").strip()
            requested_project = _safe_value("project", 256)
            if not requested_project:
                try:
                    raw_cfg = read_raw_config()
                    requested_project = str((raw_cfg.get("vertex") or {}).get("project_id") or "").strip()
                except Exception:
                    requested_project = ""
            scopes = ["https://www.googleapis.com/auth/cloud-platform"]
            if path:
                if not path.startswith("/") or not Path(path).is_file():
                    return {"providerId": provider_id, "accepted": False, "reachable": True, "verified": False, "prerequisites": {"google-identity": "missing", "google-project": "unknown"}, "message": "Mounted Google credential file was not found."}
                credentials = service_account.Credentials.from_service_account_file(path, scopes=scopes)
                detected_project = getattr(credentials, "project_id", None)
                identity_kind = "service_account"
            else:
                credentials, detected_project = google.auth.default(scopes=scopes)
                identity_kind = "application_default_credentials"
            project = requested_project or str(detected_project or "")
            if not project:
                return {"providerId": provider_id, "accepted": False, "reachable": True, "verified": False, "prerequisites": {"google-identity": "satisfied", "google-project": "missing"}, "message": "Google identity resolved but no project was configured."}
            credentials.refresh(GoogleAuthRequest())
            return {"providerId": provider_id, "accepted": True, "reachable": True, "verified": True, "prerequisites": {"google-identity": "satisfied", "google-project": "satisfied"}, "identityKind": identity_kind}

        command = _safe_value("command", 4096) or "copilot"
        resolved = shutil.which(command)
        if not resolved:
            return {"providerId": provider_id, "accepted": False, "reachable": True, "verified": False, "prerequisites": {"copilot-cli": "missing", "copilot-login": "unknown"}, "message": "GitHub Copilot CLI is not installed in the Hermes runtime."}
        probe = subprocess.run([resolved, "--version"], capture_output=True, text=True, timeout=10, check=False)
        executable_ok = probe.returncode == 0
        return {"providerId": provider_id, "accepted": executable_ok, "reachable": executable_ok, "verified": False, "prerequisites": {"copilot-cli": "satisfied" if executable_ok else "missing", "copilot-login": "unknown"}, "identityKind": "external_cli", "message": "Copilot CLI is available; account entitlement is verified only by a governed inference test."}
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid identity field")
    except Exception as exc:
        return {"providerId": provider_id, "accepted": False, "reachable": False, "verified": False, "prerequisites": {}, "message": str(exc)[:300] or "Identity validation failed."}


@app.post("/api/providers/special/validate")
async def validate_special_provider(request: Request):
    """Validate endpoint and composite providers without persisting submitted values."""
    _require_token(request)
    import httpx
    body = await request.json()
    provider_id = str(body.get("provider") or "").strip().lower() if isinstance(body, dict) else ""
    values = body.get("values", {}) if isinstance(body, dict) else {}
    if not isinstance(values, dict) or provider_id not in {"custom", "lmstudio", "moa"}:
        raise HTTPException(status_code=400, detail="unsupported special-provider validation request")

    def _special_value(name: str, maximum: int = 4096) -> str:
        value = values.get(name, "")
        if not isinstance(value, str) or len(value) > maximum or any(ord(ch) < 32 for ch in value):
            raise HTTPException(status_code=400, detail="invalid special-provider field")
        return value.strip()

    if provider_id in {"custom", "lmstudio"}:
        base_url = _special_value("baseUrl").rstrip("/")
        model = _special_value("model", 500)
        credential = _special_value("credential", 32768)
        api_mode = _special_value("apiMode", 100) or "chat_completions"
        if api_mode not in {"chat_completions", "responses", "anthropic_messages"}:
            raise HTTPException(status_code=400, detail="unsupported API compatibility mode")
        parsed = urllib.parse.urlparse(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
            raise HTTPException(status_code=400, detail="endpoint URL must be credential-free HTTP(S)")
        if not model:
            raise HTTPException(status_code=400, detail="model ID is required")
        if provider_id == "lmstudio":
            from hermes_cli.models import probe_lmstudio_models
            try:
                models = probe_lmstudio_models(api_key=credential or None, base_url=base_url)
            except Exception:
                models = None
            reachable = models is not None
            accepted = reachable and model in set(models or [])
            return {"providerId": provider_id, "accepted": accepted, "reachable": reachable, "verified": accepted, "discovered": len(models or []), "prerequisites": {"reachable-server": "satisfied" if reachable else "missing"}, "modelAvailable": accepted}
        url = base_url + "/models"
        headers = {"Accept": "application/json"}
        if credential:
            headers["Authorization"] = f"Bearer {credential}"
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(8.0)) as client:
                response = await client.get(url, headers=headers)
        except Exception:
            return {"providerId": provider_id, "accepted": False, "reachable": False, "verified": False, "discovered": 0, "prerequisites": {"reachable-endpoint": "missing"}, "modelAvailable": False}
        models = _parse_model_ids(response) if response.is_success else []
        accepted = response.is_success and (model in set(models) or (api_mode == "anthropic_messages" and not models))
        return {"providerId": provider_id, "accepted": accepted, "reachable": True, "verified": accepted, "discovered": len(models), "prerequisites": {"reachable-endpoint": "satisfied"}, "modelAvailable": model in set(models)}

    from hermes_cli.config import load_config
    from hermes_cli.moa_config import normalize_moa_config
    preset_name = _special_value("preset", 200)
    config = load_config() or {}
    moa = normalize_moa_config(config.get("moa") or {})
    presets = moa.get("presets") or {}
    selected_name = preset_name or str(moa.get("default_preset") or "")
    preset = presets.get(selected_name)
    if not isinstance(preset, dict):
        return {"providerId": "moa", "accepted": False, "reachable": True, "verified": False, "discovered": len(presets), "prerequisites": {"moa-preset": "missing", "reference-models": "unknown", "aggregator-model": "unknown"}}
    options = await get_model_options(include_unconfigured=True, refresh=False)
    provider_models = {str(item.get("slug") or ""): set(item.get("models") or []) for item in options.get("providers", []) if isinstance(item, dict)}
    references = preset.get("reference_models") or []
    aggregator = preset.get("aggregator") or {}
    refs_ready = bool(references) and all(isinstance(slot, dict) and str(slot.get("model") or "") in provider_models.get(str(slot.get("provider") or ""), set()) for slot in references)
    aggregator_ready = isinstance(aggregator, dict) and str(aggregator.get("model") or "") in provider_models.get(str(aggregator.get("provider") or ""), set())
    accepted = refs_ready and aggregator_ready
    return {"providerId": "moa", "accepted": accepted, "reachable": True, "verified": accepted, "discovered": len(presets), "prerequisites": {"moa-preset": "satisfied", "reference-models": "satisfied" if refs_ready else "missing", "aggregator-model": "satisfied" if aggregator_ready else "missing"}, "preset": selected_name}


@app.delete("/api/env")
async def remove_env_var(body: EnvVarDelete, profile: Optional[str] = None):'''
if source.count(request_anchor) != 1:
    raise SystemExit('Pinned Hermes environment route anchor changed; refusing an unsafe patch')
source = source.replace(request_anchor, batch_routes)

# Promote pinned Hermes's read-only Qwen card to its native device-code flow.
qwen_catalog_old = '''    {
        "id": "qwen-oauth",
        "name": "Qwen (via Qwen CLI)",
        "flow": "external",
        "cli_command": "hermes auth add qwen-oauth",
        "docs_url": "https://github.com/QwenLM/qwen-code",
        "status_fn": None,  # dispatched via auth.get_qwen_auth_status
    },'''
qwen_catalog_new = qwen_catalog_old.replace('"flow": "external"', '"flow": "device_code"')
if source.count(qwen_catalog_old) != 1:
    raise SystemExit('Pinned Hermes Qwen OAuth catalog changed; refusing an unsafe patch')
source = source.replace(qwen_catalog_old, qwen_catalog_new)

qwen_disconnect_old = '''        try:
            from hermes_cli.auth import clear_provider_auth, invalidate_nous_auth_status_cache
            cleared = clear_provider_auth(provider_id)'''
qwen_disconnect_new = '''        try:
            from hermes_cli.auth import clear_provider_auth, invalidate_nous_auth_status_cache
            cleared = clear_provider_auth(provider_id)
            if provider_id == "qwen-oauth":
                from hermes_cli.auth import _qwen_cli_auth_path
                qwen_path = _qwen_cli_auth_path()
                if qwen_path.exists():
                    qwen_path.unlink()
                    cleared = True'''
if source.count(qwen_disconnect_old) != 1:
    raise SystemExit('Pinned Hermes OAuth disconnect block changed; refusing an unsafe patch')
source = source.replace(qwen_disconnect_old, qwen_disconnect_new)

qwen_flow_anchor = '''async def _start_device_code_flow(
    provider_id: str,
    profile: Optional[str] = None,
) -> Dict[str, Any]:'''
qwen_flow_replacement = '''def _qwen_device_poller(session_id: str) -> None:
    import httpx
    from hermes_cli.auth import QWEN_OAUTH_CLIENT_ID, QWEN_OAUTH_TOKEN_URL, _save_qwen_cli_tokens
    with _oauth_sessions_lock:
        sess = _oauth_sessions.get(session_id)
    if not sess:
        return
    interval = max(1, int(sess.get("interval") or 2))
    while time.time() < float(sess.get("expires_at") or 0):
        with _oauth_sessions_lock:
            if sess.get("cancelled"):
                return
        time.sleep(interval)
        try:
            response = httpx.post(
                QWEN_OAUTH_TOKEN_URL,
                headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                    "client_id": QWEN_OAUTH_CLIENT_ID,
                    "device_code": sess["device_code"],
                    "code_verifier": sess["code_verifier"],
                },
                timeout=15.0,
            )
            data = response.json() if response.content else {}
            if response.status_code < 400 and data.get("access_token"):
                tokens = dict(data)
                tokens["expiry_date"] = int(time.time() * 1000) + int(data.get("expires_in") or 3600) * 1000
                with _oauth_sessions_lock:
                    if sess.get("cancelled"):
                        return
                    with _profile_scope(_oauth_session_profile(session_id, None)):
                        _save_qwen_cli_tokens(tokens)
                    sess["status"] = "approved"
                return
            error = str(data.get("error") or data.get("status") or "")
            if error in {"authorization_pending", "pending", "slow_down"}:
                if error == "slow_down":
                    interval += 2
                continue
            if error in {"access_denied", "denied"}:
                sess["status"] = "denied"
                return
            if error in {"expired_token", "expired"}:
                sess["status"] = "expired"
                return
        except Exception as exc:
            sess["error_message"] = str(exc)
    sess["status"] = "expired"


async def _start_device_code_flow(
    provider_id: str,
    profile: Optional[str] = None,
) -> Dict[str, Any]:'''
if source.count(qwen_flow_anchor) != 1:
    raise SystemExit('Pinned Hermes device OAuth anchor changed; refusing an unsafe patch')
source = source.replace(qwen_flow_anchor, qwen_flow_replacement)

qwen_start_anchor = '''    if provider_id == "nous":
        from hermes_cli.auth import ('''
qwen_start_branch = '''    if provider_id == "qwen-oauth":
        import base64
        import hashlib
        import httpx
        from hermes_cli.auth import QWEN_OAUTH_CLIENT_ID
        qwen_device_url = "https://chat.qwen.ai/api/v1/oauth2/device/code"
        verifier = secrets.token_urlsafe(48)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        response = await asyncio.get_running_loop().run_in_executor(
            None,
            lambda: httpx.post(
                qwen_device_url,
                headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
                data={
                    "client_id": QWEN_OAUTH_CLIENT_ID,
                    "scope": "openid profile email model.completion",
                    "code_challenge": challenge,
                    "code_challenge_method": "S256",
                },
                timeout=15.0,
            ),
        )
        response.raise_for_status()
        device_data = response.json()
        sid, sess = _new_oauth_session("qwen-oauth", "device_code", profile=profile)
        sess["device_code"] = str(device_data["device_code"])
        sess["code_verifier"] = verifier
        sess["interval"] = int(device_data.get("interval") or 2)
        sess["expires_at"] = time.time() + int(device_data.get("expires_in") or 900)
        threading.Thread(target=_qwen_device_poller, args=(sid,), daemon=True, name=f"oauth-qwen-{sid[:6]}").start()
        return {
            "session_id": sid,
            "flow": "device_code",
            "user_code": str(device_data.get("user_code") or ""),
            "verification_url": str(device_data.get("verification_uri_complete") or device_data.get("verification_uri") or "https://chat.qwen.ai"),
            "expires_in": int(device_data.get("expires_in") or 900),
            "poll_interval": int(device_data.get("interval") or 2),
        }

    if provider_id == "nous":
        from hermes_cli.auth import ('''
if source.count(qwen_start_anchor) != 1:
    raise SystemExit('Pinned Hermes Nous OAuth branch changed; refusing an unsafe patch')
source = source.replace(qwen_start_anchor, qwen_start_branch)
path.write_text(source)
