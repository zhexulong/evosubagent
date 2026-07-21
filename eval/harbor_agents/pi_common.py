"""Shared helpers for Harbor Pi agents (A0 / B0_cold)."""

from __future__ import annotations

import json
import os
import shlex
from typing import Any


PI_PACKAGE = os.environ.get(
    "EVOSUBAGENT_PI_NPM",
    "@earendil-works/pi-coding-agent@0.80.10",
)

DEFAULT_PROVIDER = os.environ.get("EVOSUBAGENT_PI_PROVIDER", "cpa-oai")
DEFAULT_MODEL = os.environ.get("EVOSUBAGENT_MODEL", "grok-4.5")
DEFAULT_BASE_URL = os.environ.get(
    "EVOSUBAGENT_GATEWAY_URL",
    "http://host.docker.internal:8317/v1",
)


def resolve_model_name(model_name: str | None) -> tuple[str, str]:
    """Return (provider, model_id) from harbor --model value."""
    name = model_name or f"{DEFAULT_PROVIDER}/{DEFAULT_MODEL}"
    if "/" not in name:
        raise ValueError(
            f"Model name must be provider/model, got {name!r} "
            f"(expected e.g. cpa-oai/grok-4.5)"
        )
    provider, model_id = name.split("/", 1)
    return provider, model_id


def models_json_payload(provider: str, model_id: str, base_url: str) -> dict[str, Any]:
    return {
        "providers": {
            provider: {
                "baseUrl": base_url,
                "api": "openai-completions",
                "apiKey": "$CPA_OAI_API_KEY",
                "authHeader": True,
                "compat": {
                    "supportsDeveloperRole": False,
                    "supportsReasoningEffort": False,
                },
                "models": [
                    {
                        "id": model_id,
                        "name": f"{model_id} ({provider})",
                        "reasoning": False,
                        "input": ["text"],
                        "contextWindow": 200000,
                        "maxTokens": 8192,
                        "cost": {
                            "input": 0,
                            "output": 0,
                            "cacheRead": 0,
                            "cacheWrite": 0,
                        },
                    }
                ],
            }
        }
    }


def write_models_json_shell(provider: str, model_id: str, base_url: str) -> str:
    """Shell snippet: write ~/.pi/agent/models.json inside the container."""
    payload = json.dumps(models_json_payload(provider, model_id, base_url))
    return (
        "mkdir -p $HOME/.pi/agent && "
        f"cat > $HOME/.pi/agent/models.json <<'EVO_MODELS_EOF'\n"
        f"{payload}\n"
        "EVO_MODELS_EOF"
    )


def api_key_env() -> dict[str, str]:
    """Pass gateway key into container agent process."""
    env: dict[str, str] = {}
    for key in (
        "CPA_OAI_API_KEY",
        "OPENAI_API_KEY",
        "EVOSUBAGENT_PI_API_KEY",
        "OPENAI_BASE_URL",
        "EVOSUBAGENT_GATEWAY_URL",
    ):
        val = os.environ.get(key)
        if val:
            env[key] = val
    # Prefer CPA_OAI_API_KEY for models.json $CPA_OAI_API_KEY
    if "CPA_OAI_API_KEY" not in env:
        for alt in ("EVOSUBAGENT_PI_API_KEY", "OPENAI_API_KEY"):
            if alt in env:
                env["CPA_OAI_API_KEY"] = env[alt]
                break
    return env


def quote(s: str) -> str:
    return shlex.quote(s)
