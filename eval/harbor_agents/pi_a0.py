"""Harbor A0 arm: bare Pi (no EvoSubagent)."""

from __future__ import annotations

import shlex
from pathlib import Path
from typing import override

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.agents.installed.node_install import nvm_node_install_snippet
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

from eval.harbor_agents.pi_common import (
    PI_PACKAGE,
    merge_agent_env,
    pi_print_command,
    populate_usage_from_pi_jsonl,
    resolve_base_url,
    resolve_model_name,
    write_models_json_shell,
)


class PiA0(BaseInstalledAgent):
    """Control arm: Pi only, no EvoSubagent tools or project state."""

    SUPPORTS_RESUME = False
    _OUTPUT_FILENAME = "pi-a0.txt"
    _PROMPT_PATH = "/tmp/a0-instruction.txt"

    @staticmethod
    @override
    def name() -> str:
        return "pi-a0"

    @override
    def version(self) -> str | None:
        return "0.80.10"

    @override
    def get_version_command(self) -> str | None:
        return ". ~/.nvm/nvm.sh; pi --version"

    @override
    def parse_version(self, stdout: str) -> str:
        return stdout.strip().splitlines()[-1].strip()

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        try:
            await self.exec_as_agent(
                environment,
                command=(
                    "bash -lc '. ~/.nvm/nvm.sh 2>/dev/null || true; "
                    "command -v pi >/dev/null && pi --version'"
                ),
            )
            return
        except Exception:
            pass
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
        extra = getattr(self, "extra_env", None) or {}
        base_url = resolve_base_url(extra)
        env = merge_agent_env(extra)

        await self.exec_as_agent(
            environment,
            command=write_models_json_shell(provider, model_id, base_url),
            env=env,
        )

        # Write instruction to file (avoid huge argv); pure task text for A0
        await self.exec_as_agent(
            environment,
            command=(
                f"cat > {self._PROMPT_PATH} <<'EVO_A0_EOF'\n"
                f"{instruction.rstrip()}\n"
                "EVO_A0_EOF"
            ),
            env=env,
        )

        cmd = pi_print_command(
            provider=provider,
            model_id=model_id,
            prompt_source=self._PROMPT_PATH,
            output_filename=self._OUTPUT_FILENAME,
            tools=True,
        )
        await self.exec_as_agent(environment, command=cmd, env=env)

    @override
    def populate_context_post_run(self, context: AgentContext) -> None:
        populate_usage_from_pi_jsonl(Path(self.logs_dir), self._OUTPUT_FILENAME, context)
