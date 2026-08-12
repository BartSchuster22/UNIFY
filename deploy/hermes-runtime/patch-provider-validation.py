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


@app.delete("/api/env")
async def remove_env_var(body: EnvVarDelete, profile: Optional[str] = None):'''
if source.count(request_anchor) != 1:
    raise SystemExit('Pinned Hermes environment route anchor changed; refusing an unsafe patch')
source = source.replace(request_anchor, batch_routes)
path.write_text(source)
