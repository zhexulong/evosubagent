"""Harbor A0 arm: bare Pi (no EvoSubagent)."""

from __future__ import annotations

import json
import shlex
from pathlib import Path
from typing import override

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.agents.installed.node_install import nvm_node_install_snippet
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

from eval.harbor_agents.pi_common import (
    DEFAULT_BASE_URL,
    PI_PACKAGE,
    api_key_env,
    resolve_model_name,
    write_models_json_shell,
)


class PiA0(BaseInstalledAgent):
    """Control arm: Pi only, no EvoSubagent tools or project state."""

    SUPPORTS_RESUME = False
    _OUTPUT_FILENAME = "pi-a0.txt"

    @staticmethod
    @override
    def name() -> str:
        return "pi-a0"

    @override
    def version(self) -> str | None:
        return "0.80.10"

    @override
    def get_version_command(self) -> str | None:
        return '. ~/.nvm/nvm.sh; pi --version'

    @override
    def parse_version(self, stdout: str) -> str:
        return stdout.strip().splitlines()[-1].strip()

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        await self.exec_as_root(
            environment,
            command="apt-get update && apt-get install -y curl git ca-certificates",
            env={"DEBIAN_FRONTEND": "noninteractive"},
        )
        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                f"{nvm_node_install_snippet()} && "
                f"npm install -g {PI_PACKAGE} && "
                "pi --version"
            ),
        )

    @override
    @with_prompt_template
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        provider, model_id = resolve_model_name(self.model_name)
        base_url = (
            self.extra_env.get("EVOSUBAGENT_GATEWAY_URL")
            if getattr(self, "extra_env", None)
            else None
        ) or DEFAULT_BASE_URL

        env = api_key_env()
        if getattr(self, "extra_env", None):
            env.update({k: v for k, v in self.extra_env.items() if v})

        setup = write_models_json_shell(provider, model_id, base_url)
        await self.exec_as_agent(environment, command=setup, env=env)

        cmd = (
            f". ~/.nvm/nvm.sh; "
            f"export CPA_OAI_API_KEY=\"${{CPA_OAI_API_KEY:-$OPENAI_API_KEY}}\"; "
            f"pi --print --mode json --session-dir /logs/agent/pi/sessions "
            f"--provider {shlex.quote(provider)} --model {shlex.quote(model_id)} "
            f"{shlex.quote(instruction)} "
            f'2>&1 </dev/null | grep -v \'"type":"message_update"\' | '
            f"stdbuf -oL tee /logs/agent/{self._OUTPUT_FILENAME}"
        )
        await self.exec_as_agent(environment, command=cmd, env=env)

    @override
    def populate_context_post_run(self, context: AgentContext) -> None:
        output_file = Path(self.logs_dir) / self._OUTPUT_FILENAME
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
