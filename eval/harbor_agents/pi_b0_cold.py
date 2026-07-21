"""Harbor B0_cold arm: Pi + EvoSubagent cold templates (no evolve)."""

from __future__ import annotations

import json
import os
import shlex
import textwrap
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

# Cold presets: routing descriptions required by define/schema
WORKER_MD = textwrap.dedent(
    """\
    ---
    name: worker
    description: Use when implementing a focused coding or terminal task in a repository.
    ---

    You are a coding worker subagent.

    Rules:
    - Prefer small, testable shell/code changes that satisfy the task instruction.
    - Inspect the environment with shell tools before editing.
    - Do not invent APIs that are not present.
    - Finish when verification would pass.
    """
)

EXPLORE_MD = textwrap.dedent(
    """\
    ---
    name: explore
    description: Use when you need to locate files, configs, or understand repo layout before editing.
    ---

    You are an explore subagent.

    Rules:
    - Map the filesystem and relevant configs first.
    - Report paths and facts; prefer read-only commands.
    - Hand off a concise map for the worker.
    """
)

REVIEWER_MD = textwrap.dedent(
    """\
    ---
    name: reviewer
    description: Use when checking whether a change satisfies the task tests or acceptance criteria.
    ---

    You are a reviewer subagent.

    Rules:
    - Re-read the instruction and run verification-oriented checks.
    - Call out missing steps before declaring done.
    """
)


class PiB0Cold(BaseInstalledAgent):
    """Cold EvoSubagent: templates present, evolve disabled (no host patches)."""

    SUPPORTS_RESUME = False
    _OUTPUT_FILENAME = "pi-b0-cold.txt"

    @staticmethod
    @override
    def name() -> str:
        return "pi-b0-cold"

    @override
    def version(self) -> str | None:
        return "0.80.10+evosubagent-b0"

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
        await self.exec_as_agent(
            environment,
            command=self._install_bundle_command(),
        )

    def _install_bundle_command(self) -> str:
        def heredoc(path: str, body: str) -> str:
            return f"cat > {path} <<'EOF'\n{body.rstrip()}\nEOF\n"

        parts = [
            "set -euo pipefail",
            "BUNDLE=$HOME/evosubagent-bundle",
            "mkdir -p $BUNDLE/.evosubagent/subagents/worker",
            "mkdir -p $BUNDLE/.evosubagent/subagents/explore",
            "mkdir -p $BUNDLE/.evosubagent/subagents/reviewer",
            "mkdir -p $BUNDLE/.evosubagent/evolution/versions",
            "mkdir -p $BUNDLE/.evosubagent/evolution/patches",
            "mkdir -p $BUNDLE/.evosubagent/runs",
            "mkdir -p $BUNDLE/.evosubagent/materialized",
            heredoc("$BUNDLE/.evosubagent/subagents/worker/SUBAGENT.md", WORKER_MD),
            heredoc("$BUNDLE/.evosubagent/subagents/explore/SUBAGENT.md", EXPLORE_MD),
            heredoc("$BUNDLE/.evosubagent/subagents/reviewer/SUBAGENT.md", REVIEWER_MD),
            heredoc(
                "$BUNDLE/EVOSUBAGENT_COLD.md",
                "# EvoSubagent cold presets (B0)\n\n"
                "Project path: $HOME/evosubagent-bundle\n"
                "Subagents: worker, explore, reviewer (no evolved patches).\n"
                "Prefer routing: explore → worker → reviewer when helpful.\n"
                "Do not invent evolve/apply — cold arm only.\n",
            ),
        ]
        return "\n".join(parts)

    @override
    @with_prompt_template
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        provider, model_id = resolve_model_name(self.model_name)
        base_url = DEFAULT_BASE_URL
        if getattr(self, "extra_env", None) and self.extra_env.get(
            "EVOSUBAGENT_GATEWAY_URL"
        ):
            base_url = self.extra_env["EVOSUBAGENT_GATEWAY_URL"]

        env = api_key_env()
        if getattr(self, "extra_env", None):
            env.update({k: v for k, v in self.extra_env.items() if v})

        await self.exec_as_agent(
            environment,
            command=write_models_json_shell(provider, model_id, base_url),
            env=env,
        )

        cold_prefix = (
            "You have EvoSubagent cold presets at $HOME/evosubagent-bundle "
            "(worker/explore/reviewer SUBAGENT.md). Read EVOSUBAGENT_COLD.md. "
            "Use those specialist roles as guidance while solving the task. "
            "Evolve is disabled.\n\nTask:\n"
        )
        full_instruction = cold_prefix + instruction

        cmd = (
            f". ~/.nvm/nvm.sh; "
            f"export CPA_OAI_API_KEY=\"${{CPA_OAI_API_KEY:-$OPENAI_API_KEY}}\"; "
            f"pi --print --mode json --session-dir /logs/agent/pi/sessions "
            f"--provider {shlex.quote(provider)} --model {shlex.quote(model_id)} "
            f"{shlex.quote(full_instruction)} "
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
