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
    "NOVITA_API_KEY": ("https://api.novita.ai/openai/v1/models", "bearer"),
    "DASHSCOPE_API_KEY": ("https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models", "bearer"),
    "XIAOMI_API_KEY": ("https://api.xiaomimimo.com/v1/models", "bearer"),
    "NVIDIA_API_KEY": ("https://integrate.api.nvidia.com/v1/models", "bearer"),
    "HF_TOKEN": ("https://router.huggingface.co/v1/models", "bearer"),
    "DEEPSEEK_API_KEY": ("https://api.deepseek.com/v1/models", "bearer"),
    "XAI_API_KEY": ("https://api.x.ai/v1/models", "bearer"),
    "KIMI_CN_API_KEY": ("https://api.moonshot.cn/v1/models", "bearer"),
    "STEPFUN_API_KEY": ("https://api.stepfun.ai/step_plan/v1/models", "bearer"),
    "MINIMAX_API_KEY": ("https://api.minimax.io/v1/models", "bearer"),
    "MINIMAX_CN_API_KEY": ("https://api.minimaxi.com/v1/models", "bearer"),
    "OLLAMA_API_KEY": ("https://ollama.com/v1/models", "bearer"),
    "ARCEEAI_API_KEY": ("https://api.arcee.ai/api/v1/models", "bearer"),
    "GMI_API_KEY": ("https://api.gmi-serving.com/v1/models", "bearer"),
    "KILOCODE_API_KEY": ("https://api.kilo.ai/api/gateway/models", "bearer"),
    "OPENCODE_ZEN_API_KEY": ("https://opencode.ai/zen/v1/models", "bearer"),
    "OPENCODE_GO_API_KEY": ("https://opencode.ai/zen/go/v1/models", "bearer"),
    "AI_GATEWAY_API_KEY": ("https://ai-gateway.vercel.sh/v1/models", "bearer"),
    "DEEPINFRA_API_KEY": ("https://api.deepinfra.com/v1/openai/models", "bearer"),
    "UPSTAGE_API_KEY": ("https://api.upstage.ai/v1/models", "bearer"),
    # Other Hermes provider families retained from the pinned release.
    "OPENAI_API_KEY": ("https://api.openai.com/v1/models", "bearer"),
    "GEMINI_API_KEY": ("https://generativelanguage.googleapis.com/v1beta/models", "query"),
}'''
if source.count(old) != 1:
    raise SystemExit('Pinned Hermes credential-probe block changed; refusing an unsafe patch')
path.write_text(source.replace(old, new))
