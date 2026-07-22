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
        need_pi = True
        try:
            await self.exec_as_agent(
                environment,
                command=(
                    "bash -lc '. ~/.nvm/nvm.sh 2>/dev/null || true; "
                    "command -v pi >/dev/null && pi --version'"
                ),
            )
            need_pi = False
        except Exception:
            need_pi = True

        await self.exec_as_root(
            environment,
            command="apt-get update && apt-get install -y curl git ca-certificates tar",
            env={"DEBIAN_FRONTEND": "noninteractive"},
        )
        if need_pi:
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
        return f"""\
import {{ writeFile }} from 'node:fs/promises';
import {{ materializeSubagentContext }} from '{REMOTE_EVOSUBAGENT_ROOT}/src/spawn/materialize.mjs';
import {{ buildPiChildPrompt }} from '{REMOTE_EVOSUBAGENT_ROOT}/src/spawn/pi-child.mjs';
import {{ writeRunRecord }} from '{REMOTE_EVOSUBAGENT_ROOT}/src/ledger/run.mjs';

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
const patches = mat.context.appliedPatches ?? [];
if (Array.isArray(patches) && patches.length > 0) {{
  throw new Error('B0_cold requires evolve off: appliedPatches must be empty');
}}
const prompt = buildPiChildPrompt({{
  subagentName,
  activeVersion: mat.activeVersion,
  definitionDigest: mat.definitionDigest,
  body: mat.context.effective.body,
  task,
}});
await writeFile({json_dumps(REMOTE_PROMPT_TXT)}, prompt, 'utf8');

// Pre-flight ledger row (kernel path); status updated after Pi if needed.
const ledger = await writeRunRecord({{
  projectRoot,
  subagentName,
  task,
  activeVersion: mat.activeVersion,
  definitionDigest: mat.definitionDigest,
  materializedContextRef: mat.materializedContextRef,
  resultSummary: 'b0_cold_pre_pi',
  runtime: 'pi-child-harbor-b0',
  status: 'ok',
}});

await writeFile(
  {json_dumps(REMOTE_MATERIALIZE_JSON)},
  JSON.stringify(
    {{
      ok: true,
      arm: 'B0_cold',
      armKind: 'kernel_b0_cold',
      evolve: false,
      subagentName,
      activeVersion: mat.activeVersion,
      definitionDigest: mat.definitionDigest,
      appliedPatches: patches,
      materializedContextRef: mat.materializedContextRef,
      runId: ledger.record.runId,
      runRef: ledger.runRef,
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
  runId: ledger.record.runId,
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

        post_script = self._post_pi_ledger_script()
        post_path = "/tmp/evosubagent-post-pi-ledger.mjs"
        await self.exec_as_agent(
            environment,
            command=(
                f"cat > {post_path} <<'EVO_POST_EOF'\n"
                f"{post_script}"
                "EVO_POST_EOF\n"
                f". ~/.nvm/nvm.sh 2>/dev/null || true; node {post_path}"
            ),
            env=env,
        )
        await self.exec_as_agent(
            environment,
            command=(
                f"cp -a {REMOTE_PROJECT_ROOT}/.evosubagent/runs /logs/agent/runs 2>/dev/null || true"
            ),
            env=env,
        )

    def _post_pi_ledger_script(self) -> str:
        return f"""\
import {{ readFile, writeFile }} from 'node:fs/promises';
import {{ readRunRecord }} from '{REMOTE_EVOSUBAGENT_ROOT}/src/ledger/run.mjs';

const meta = JSON.parse(await readFile({json_dumps(REMOTE_MATERIALIZE_JSON)}, 'utf8'));
if (!meta.runId) process.exit(0);
const pi = await readFile('/logs/agent/{self._OUTPUT_FILENAME}', 'utf8').catch(() => '');
const rate = /Concurrency limit exceeded|rate.?limit|please retry later|429/i.test(pi);
const {{ runRef, record }} = await readRunRecord({json_dumps(REMOTE_PROJECT_ROOT)}, meta.runId);
record.resultSummary = pi.slice(0, 500);
record.status = rate ? 'error' : 'ok';
record.runtime = 'pi-child-harbor-b0';
await writeFile(runRef, JSON.stringify(record, null, 2) + '\\n');
await writeFile(
  '/logs/agent/run-ledger.json',
  JSON.stringify({{ ...record, runRef }}, null, 2) + '\\n',
);
console.log(JSON.stringify({{ ok: true, runId: meta.runId, status: record.status, rateLimited: rate }}));
"""

    @override
    def populate_context_post_run(self, context: AgentContext) -> None:
        populate_usage_from_pi_jsonl(Path(self.logs_dir), self._OUTPUT_FILENAME, context)


def json_dumps(value: str) -> str:
    import json

    return json.dumps(value)
