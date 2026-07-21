"""Shared helpers for Harbor Pi agents (A0 / B0_cold)."""

from __future__ import annotations

import json
import os
import shlex
import tarfile
import tempfile
from pathlib import Path
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

# In-container layout
REMOTE_EVOSUBAGENT_ROOT = "/opt/evosubagent"
REMOTE_PROJECT_ROOT = "/opt/evosubagent-project"
REMOTE_MATERIALIZE_JSON = "/tmp/evosubagent-materialize.json"
REMOTE_PROMPT_TXT = "/tmp/evosubagent-prompt.txt"


def repo_root() -> Path:
    """evosubagent git root (eval/harbor_agents/../..)."""
    return Path(__file__).resolve().parents[2]


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
    if "CPA_OAI_API_KEY" not in env:
        for alt in ("EVOSUBAGENT_PI_API_KEY", "OPENAI_API_KEY"):
            if alt in env:
                env["CPA_OAI_API_KEY"] = env[alt]
                break
    return env


def merge_agent_env(extra_env: dict[str, str] | None) -> dict[str, str]:
    env = api_key_env()
    if extra_env:
        env.update({k: v for k, v in extra_env.items() if v})
    return env


def resolve_base_url(extra_env: dict[str, str] | None) -> str:
    if extra_env and extra_env.get("EVOSUBAGENT_GATEWAY_URL"):
        return extra_env["EVOSUBAGENT_GATEWAY_URL"]
    return DEFAULT_BASE_URL


def quote(s: str) -> str:
    return shlex.quote(s)


def make_src_tarball(dest: Path | None = None) -> Path:
    """Pack host src/ + package.json for upload into Harbor env."""
    root = repo_root()
    src_dir = root / "src"
    if not src_dir.is_dir():
        raise FileNotFoundError(f"missing package src at {src_dir}")
    if dest is None:
        tmp = tempfile.NamedTemporaryFile(prefix="evosubagent-src-", suffix=".tar.gz", delete=False)
        dest = Path(tmp.name)
        tmp.close()
    with tarfile.open(dest, "w:gz") as tar:
        tar.add(src_dir, arcname="src")
        pkg = root / "package.json"
        if pkg.is_file():
            tar.add(pkg, arcname="package.json")
    return dest


def populate_usage_from_pi_jsonl(logs_dir: Path, filename: str, context: Any) -> None:
    """Parse Pi --mode json NDJSON for token usage into Harbor AgentContext."""
    output_file = Path(logs_dir) / filename
    if not output_file.exists():
        return
    total_in = total_out = total_cache = 0
    total_cost = 0.0
    for line in output_file.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") != "message_end":
            continue
        message = event.get("message") or {}
        if message.get("role") != "assistant":
            continue
        usage = message.get("usage") or {}
        total_in += usage.get("input", 0)
        total_out += usage.get("output", 0)
        total_cache += usage.get("cacheRead", 0)
        cost = usage.get("cost") or {}
        total_cost += cost.get("total", 0.0)
    context.n_input_tokens = total_in + total_cache
    context.n_output_tokens = total_out
    context.n_cache_tokens = total_cache
    context.cost_usd = total_cost if total_cost > 0 else None


def pi_print_command(
    *,
    provider: str,
    model_id: str,
    prompt_source: str,
    output_filename: str,
    tools: bool = True,
) -> str:
    """
    Build in-container pi invocation.
    prompt_source: either a shell-quoted string literal path after $(cat ...) or inline.
    We always use: pi -p --mode json with prompt from file via $(cat path) to avoid ARG_MAX.
    """
    tools_flag = "" if tools else "--no-tools "
    return (
        f". ~/.nvm/nvm.sh; "
        f"export CPA_OAI_API_KEY=\"${{CPA_OAI_API_KEY:-$OPENAI_API_KEY}}\"; "
        f"PROMPT=$(cat {quote(prompt_source)}); "
        f"pi --print --mode json --session-dir /logs/agent/pi/sessions "
        f"{tools_flag}"
        f"--provider {quote(provider)} --model {quote(model_id)} "
        f"\"$PROMPT\" "
        f'2>&1 </dev/null | grep -v \'"type":"message_update"\' | '
        f"stdbuf -oL tee /logs/agent/{output_filename}"
    )
