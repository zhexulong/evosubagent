"""Harbor B0_cold arm: real EvoSubagent materialize → Pi with materialized prompt."""

from __future__ import annotations

from pathlib import Path
from typing import override

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.agents.installed.node_install import nvm_node_install_snippet
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

from eval.harbor_agents.pi_common import (
    PI_PACKAGE,
    REMOTE_EVOSUBAGENT_ROOT,
    REMOTE_MATERIALIZE_JSON,
    REMOTE_PROJECT_ROOT,
    REMOTE_PROMPT_TXT,
    make_src_tarball,
    merge_agent_env,
    pi_print_command,
    populate_usage_from_pi_jsonl,
    quote,
    resolve_base_url,
    resolve_model_name,
    write_models_json_shell,
)


class PiB0Cold(BaseInstalledAgent):
    """
    Cold EvoSubagent arm (docs/13 B0):

    1. Install Pi + upload real evosubagent package (src/)
    2. ``init --template cold-presets`` → worker/explore/reviewer SUBAGENT.md
    3. On each task: ``materializeSubagentContext`` (no evolve) → prompt contract
    4. Run Pi with materialized body+task (tools enabled)

    Evolve is disabled — no applyEvolutionPatch. This is the true cold outcome arm.
    """

    SUPPORTS_RESUME = False
    _OUTPUT_FILENAME = "pi-b0-cold.txt"
    _DEFAULT_SUBAGENT = "worker"
    _REMOTE_TGZ = "/tmp/evosubagent-src.tar.gz"

    @staticmethod
    @override
    def name() -> str:
        return "pi-b0-cold"

    @override
    def version(self) -> str | None:
        return "0.80.10+evosubagent-materialize"

    @override
    def get_version_command(self) -> str | None:
        return ". ~/.nvm/nvm.sh; pi --version"

    @override
    def parse_version(self, stdout: str) -> str:
        return stdout.strip().splitlines()[-1].strip()

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        await self.exec_as_root(
            environment,
            command="apt-get update && apt-get install -y curl git ca-certificates tar",
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

        # Upload real package source
        tgz = make_src_tarball()
        try:
            await environment.upload_file(str(tgz), self._REMOTE_TGZ)
            # upload_file is root-owned; fix ownership then extract
            await self.exec_as_root(
                environment,
                command=(
                    f"mkdir -p {REMOTE_EVOSUBAGENT_ROOT} && "
                    f"tar -xzf {self._REMOTE_TGZ} -C {REMOTE_EVOSUBAGENT_ROOT} && "
                    f"chown -R $(id -u):$(id -g) {REMOTE_EVOSUBAGENT_ROOT} 2>/dev/null || "
                    f"chmod -R a+rX {REMOTE_EVOSUBAGENT_ROOT}"
                ),
            )
            # Prefer agent-user ownership via chown to agent if we can resolve name
            await self.exec_as_agent(
                environment,
                command=(
                    f"test -f {REMOTE_EVOSUBAGENT_ROOT}/src/spawn/materialize.mjs && "
                    f"test -f {REMOTE_EVOSUBAGENT_ROOT}/src/cli/init.mjs"
                ),
            )
        finally:
            tgz.unlink(missing_ok=True)

        # Cold project: full .evosubagent tree + cold-presets (worker/explore/reviewer)
        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                f". ~/.nvm/nvm.sh; "
                f"node {REMOTE_EVOSUBAGENT_ROOT}/src/cli/main.mjs init "
                f"--project {REMOTE_PROJECT_ROOT} --template cold-presets"
            ),
        )

    def _materialize_node_script(self, task: str, subagent: str) -> str:
        """JS executed in-container: materialize cold definition → write prompt file."""
        # Escape task for embedding in single-quoted heredoc is handled by outer heredoc
        return f"""\
import {{ writeFile, mkdir }} from 'node:fs/promises';
import {{ materializeSubagentContext }} from '{REMOTE_EVOSUBAGENT_ROOT}/src/spawn/materialize.mjs';
import {{ buildPiChildPrompt }} from '{REMOTE_EVOSUBAGENT_ROOT}/src/spawn/pi-child.mjs';

const projectRoot = {json_dumps(REMOTE_PROJECT_ROOT)};
const subagentName = {json_dumps(subagent)};
const task = {json_dumps(task)};

const mat = await materializeSubagentContext({{ projectRoot, subagentName, task }});
if (!mat?.context?.effective?.body) {{
  throw new Error('materialize missing effective.body');
}}
if (!mat.activeVersion) {{
  throw new Error('materialize missing activeVersion');
}}
const prompt = buildPiChildPrompt({{
  subagentName,
  activeVersion: mat.activeVersion,
  definitionDigest: mat.definitionDigest,
  body: mat.context.effective.body,
  task,
}});
await writeFile({json_dumps(REMOTE_PROMPT_TXT)}, prompt, 'utf8');
await writeFile(
  {json_dumps(REMOTE_MATERIALIZE_JSON)},
  JSON.stringify(
    {{
      ok: true,
      arm: 'B0_cold',
      subagentName,
      activeVersion: mat.activeVersion,
      definitionDigest: mat.definitionDigest,
      appliedPatches: mat.context.appliedPatches ?? [],
      materializedContextRef: mat.materializedContextRef,
      bodyPreview: String(mat.context.effective.body).slice(0, 200),
    }},
    null,
    2,
  ) + '\\n',
  'utf8',
);
console.log(JSON.stringify({{
  ok: true,
  activeVersion: mat.activeVersion,
  definitionDigest: mat.definitionDigest,
  promptBytes: Buffer.byteLength(prompt),
}}));
"""

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
        subagent = extra.get("EVOSUBAGENT_NAME") or self._DEFAULT_SUBAGENT

        await self.exec_as_agent(
            environment,
            command=write_models_json_shell(provider, model_id, base_url),
            env=env,
        )

        # Real materialize (cold VersionState, no evolve)
        script_path = "/tmp/evosubagent-materialize-run.mjs"
        script = self._materialize_node_script(instruction, subagent)
        await self.exec_as_agent(
            environment,
            command=(
                f"cat > {script_path} <<'EVO_MAT_EOF'\n"
                f"{script}"
                "EVO_MAT_EOF\n"
                f". ~/.nvm/nvm.sh; node {script_path}"
            ),
            env=env,
        )

        # Fail closed if materialize artifact missing
        await self.exec_as_agent(
            environment,
            command=(
                f"test -s {REMOTE_PROMPT_TXT} && test -s {REMOTE_MATERIALIZE_JSON} && "
                f"grep -q activeVersion {REMOTE_MATERIALIZE_JSON}"
            ),
            env=env,
        )

        # Copy materialize proof into Harbor agent logs for post-hoc audit
        await self.exec_as_agent(
            environment,
            command=(
                f"cp {REMOTE_MATERIALIZE_JSON} /logs/agent/materialize.json && "
                f"cp {REMOTE_PROMPT_TXT} /logs/agent/materialized-prompt.txt"
            ),
            env=env,
        )

        cmd = pi_print_command(
            provider=provider,
            model_id=model_id,
            prompt_source=REMOTE_PROMPT_TXT,
            output_filename=self._OUTPUT_FILENAME,
            tools=True,
        )
        await self.exec_as_agent(environment, command=cmd, env=env)

    @override
    def populate_context_post_run(self, context: AgentContext) -> None:
        populate_usage_from_pi_jsonl(Path(self.logs_dir), self._OUTPUT_FILENAME, context)


def json_dumps(value: str) -> str:
    """JSON-encode a string for embedding in generated JS source."""
    import json

    return json.dumps(value)
