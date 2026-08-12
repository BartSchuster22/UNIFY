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
path.write_text(source.replace(request_old, request_new))
