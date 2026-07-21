#!/usr/bin/env node
/**
 * Local dual-arm smoke for fix-git without full Harbor agent install path.
 * Uses pre-baked alexgshaw/fix-git:20251031 (curl/uv/pi) + host network for gateway/proxy.
 *
 * Arms:
 *   A0      — bare pi on task instruction
 *   B0_cold — real materialize + buildPiChildPrompt then pi
 *
 * Requires: docker, pi image baked, CPA key, host gateway on 127.0.0.1:8317
 */
import { mkdir, writeFile, readFile, cp, rm, mkdtemp, access } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, homedir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { initProject } from '../../src/cli/init.mjs';
import { materializeSubagentContext } from '../../src/spawn/materialize.mjs';
import { buildPiChildPrompt } from '../../src/spawn/pi-child.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TASK = resolve(REPO, 'eval/cache/terminal-bench-2.0/fix-git');
const IMAGE = process.env.EVOSUBAGENT_FIX_GIT_IMAGE || 'alexgshaw/fix-git:20251031';
const MODEL = process.env.EVOSUBAGENT_MODEL || 'grok-4.5';
const PROVIDER = process.env.EVOSUBAGENT_PI_PROVIDER || 'cpa-oai';
const OUT_DIR = resolve(REPO, 'eval/out');

async function loadKey() {
  if (process.env.CPA_OAI_API_KEY) return process.env.CPA_OAI_API_KEY;
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const j = JSON.parse(await readFile(join(homedir(), '.config/opencode/opencode.json'), 'utf8'));
  return j.provider['cpa-oai'].options.apiKey;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(opts.env || {}) },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, opts.timeoutMs || 900_000);
    child.stdout.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function prepareWorkspace() {
  const work = await mkdtemp(join(tmpdir(), 'fix-git-arm-'));
  // copy personal-site state from image is hard; instead run container with volume for logs only
  // Harbor image WORKDIR is /app/personal-site with git already set up.
  return work;
}

/**
 * @param {'A0'|'B0_cold'} arm
 * @param {string} key
 */
async function runArm(arm, key) {
  const started = Date.now();
  const work = await prepareWorkspace();
  const logs = join(work, 'logs');
  await mkdir(join(logs, 'agent'), { recursive: true });
  await mkdir(join(logs, 'verifier'), { recursive: true });

  const instruction = (
    await readFile(join(TASK, 'instruction.md'), 'utf8')
  )
    .split('\n')
    .filter((l) => !l.includes('BENCHMARK DATA SHOULD NEVER'))
    .join('\n')
    .trim();

  let prompt = instruction;
  /** @type {Record<string, unknown>|null} */
  let materializeMeta = null;

  if (arm === 'B0_cold') {
    const projectRoot = join(work, 'evo-project');
    await initProject({ projectRoot, template: 'cold-presets' });
    const mat = await materializeSubagentContext({
      projectRoot,
      subagentName: 'worker',
      task: instruction,
    });
    prompt = buildPiChildPrompt({
      subagentName: 'worker',
      activeVersion: mat.activeVersion,
      definitionDigest: mat.definitionDigest,
      body: mat.context.effective.body,
      task: instruction,
    });
    materializeMeta = {
      activeVersion: mat.activeVersion,
      definitionDigest: mat.definitionDigest,
      appliedPatches: mat.context.appliedPatches ?? [],
      bodyPreview: String(mat.context.effective.body).slice(0, 160),
    };
    await writeFile(join(logs, 'agent', 'materialize.json'), `${JSON.stringify(materializeMeta, null, 2)}\n`);
    await writeFile(join(logs, 'agent', 'materialized-prompt.txt'), prompt);
  }

  await writeFile(join(work, 'prompt.txt'), prompt);

  // Run agent in container: host network for 127.0.0.1:8317 gateway + optional proxy
  const modelsJson = {
    providers: {
      [PROVIDER]: {
        baseUrl: 'http://127.0.0.1:8317/v1',
        api: 'openai-completions',
        apiKey: '$CPA_OAI_API_KEY',
        authHeader: true,
        compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
        models: [
          {
            id: MODEL,
            name: `${MODEL} (${PROVIDER})`,
            reasoning: false,
            input: ['text'],
            contextWindow: 200000,
            maxTokens: 8192,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      },
    },
  };
  await writeFile(join(work, 'models.json'), `${JSON.stringify(modelsJson, null, 2)}\n`);

  const agentScript = `set -euo pipefail
. /root/.nvm/nvm.sh
export CPA_OAI_API_KEY="${key.replace(/"/g, '\\"')}"
export OPENAI_API_KEY="$CPA_OAI_API_KEY"
mkdir -p /root/.pi/agent
cp /work/models.json /root/.pi/agent/models.json
PROMPT=$(cat /work/prompt.txt)
cd /app/personal-site
pi --print --mode json --session-dir /logs/agent/pi-sessions \\
  --provider ${PROVIDER} --model ${MODEL} "$PROMPT" \\
  2>&1 </dev/null | grep -v '"type":"message_update"' | tee /logs/agent/pi-out.txt
`;
  await writeFile(join(work, 'run-agent.sh'), agentScript);

  const agentRun = await run(
    'docker',
    [
      'run',
      '--rm',
      '--network=host',
      '-e',
      'http_proxy=http://127.0.0.1:7897',
      '-e',
      'https_proxy=http://127.0.0.1:7897',
      '-v',
      `${work}:/work`,
      '-v',
      `${logs}:/logs`,
      IMAGE,
      'bash',
      '/work/run-agent.sh',
    ],
    { timeoutMs: 900_000 },
  );

  // Verifier: mount tests + logs, run test.sh from task
  // copy tests into work
  await cp(join(TASK, 'tests'), join(work, 'tests'), { recursive: true });
  const verScript = `set -euo pipefail
export http_proxy=http://127.0.0.1:7897
export https_proxy=http://127.0.0.1:7897
export HTTP_PROXY=$http_proxy HTTPS_PROXY=$https_proxy
cd /app/personal-site
bash /tests/test.sh || true
`;
  await writeFile(join(work, 'run-verifier.sh'), verScript);

  // Need same container FS state after agent - agent container was --rm so state LOST.
  // Must keep one container for agent+verifier. Rewrite as single container session.
  await rm(work, { recursive: true, force: true });
  return {
    arm,
    note: 'single-container path required; see runArmUnified',
    agentCode: agentRun.code,
  };
}

/**
 * Unified: one container, agent then verifier (preserves FS).
 * @param {'A0'|'B0_cold'} arm
 * @param {string} key
 */
async function runArmUnified(arm, key) {
  const started = Date.now();
  const work = await mkdtemp(join(tmpdir(), `fix-git-${arm}-`));
  const logs = join(work, 'logs');
  await mkdir(join(logs, 'agent'), { recursive: true });
  await mkdir(join(logs, 'verifier'), { recursive: true });
  await cp(join(TASK, 'tests'), join(work, 'tests'), { recursive: true });

  const instruction = (await readFile(join(TASK, 'instruction.md'), 'utf8'))
    .split('\n')
    .filter((l) => !l.includes('BENCHMARK DATA SHOULD NEVER'))
    .join('\n')
    .trim();

  let prompt = instruction;
  /** @type {Record<string, unknown>|null} */
  let materializeMeta = null;
  if (arm === 'B0_cold') {
    const projectRoot = join(work, 'evo-project');
    await initProject({ projectRoot, template: 'cold-presets' });
    const mat = await materializeSubagentContext({
      projectRoot,
      subagentName: 'worker',
      task: instruction,
    });
    prompt = buildPiChildPrompt({
      subagentName: 'worker',
      activeVersion: mat.activeVersion,
      definitionDigest: mat.definitionDigest,
      body: mat.context.effective.body,
      task: instruction,
    });
    materializeMeta = {
      activeVersion: mat.activeVersion,
      definitionDigest: mat.definitionDigest,
      appliedPatches: mat.context.appliedPatches ?? [],
      bodyPreview: String(mat.context.effective.body).slice(0, 160),
      materializedContextRef: mat.materializedContextRef,
    };
    await writeFile(
      join(logs, 'agent', 'materialize.json'),
      `${JSON.stringify(materializeMeta, null, 2)}\n`,
    );
    await writeFile(join(logs, 'agent', 'materialized-prompt.txt'), prompt);
  }
  await writeFile(join(work, 'prompt.txt'), prompt);
  await writeFile(
    join(work, 'models.json'),
    `${JSON.stringify(
      {
        providers: {
          [PROVIDER]: {
            baseUrl: 'http://127.0.0.1:8317/v1',
            api: 'openai-completions',
            apiKey: '$CPA_OAI_API_KEY',
            authHeader: true,
            compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
            models: [
              {
                id: MODEL,
                name: `${MODEL} (${PROVIDER})`,
                reasoning: false,
                input: ['text'],
                contextWindow: 200000,
                maxTokens: 8192,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ],
          },
        },
      },
      null,
      2,
    )}\n`,
  );

  const script = `set -euo pipefail
export http_proxy=http://127.0.0.1:7897
export https_proxy=http://127.0.0.1:7897
export HTTP_PROXY=$http_proxy HTTPS_PROXY=$https_proxy
. /root/.nvm/nvm.sh
export CPA_OAI_API_KEY='${key.replace(/'/g, `'\\''`)}'
export OPENAI_API_KEY="$CPA_OAI_API_KEY"
mkdir -p /root/.pi/agent /logs/agent /logs/verifier
cp /work/models.json /root/.pi/agent/models.json
PROMPT=$(cat /work/prompt.txt)
cd /app/personal-site
set +e
pi --print --mode json --session-dir /logs/agent/pi-sessions \\
  --provider ${PROVIDER} --model ${MODEL} "$PROMPT" \\
  2>&1 </dev/null | grep -v '"type":"message_update"' | tee /logs/agent/pi-out.txt
AGENT_EC=\${PIPESTATUS[0]}
set -e
# verifier
bash /work/tests/test.sh
echo AGENT_EC=\$AGENT_EC
`;
  await writeFile(join(work, 'run.sh'), script);

  const result = await run(
    'docker',
    [
      'run',
      '--rm',
      '--network=host',
      '-v',
      `${work}:/work`,
      '-v',
      `${logs}:/logs`,
      '-v',
      `${join(work, 'tests')}:/tests`,
      IMAGE,
      'bash',
      '/work/run.sh',
    ],
    { timeoutMs: 900_000 },
  );

  let reward = null;
  try {
    reward = Number((await readFile(join(logs, 'verifier', 'reward.txt'), 'utf8')).trim());
  } catch {
    reward = null;
  }

  const wall_s = (Date.now() - started) / 1000;
  const out = {
    arm,
    reward,
    wall_s,
    dockerExit: result.code,
    materialize: materializeMeta,
    modelRef: `${PROVIDER}/${MODEL}`,
    image: IMAGE,
    logsDir: logs,
    stderrTail: result.stderr.slice(-500),
    stdoutTail: result.stdout.slice(-800),
  };
  return out;
}

async function main() {
  await access(TASK);
  const key = await loadKey();
  if (!key) throw new Error('missing API key');

  // image present?
  const img = spawnSync('docker', ['image', 'inspect', IMAGE], { encoding: 'utf8' });
  if (img.status !== 0) throw new Error(`missing image ${IMAGE}`);

  const a0 = await runArmUnified('A0', key);
  const b0 = await runArmUnified('B0_cold', key);

  const summary = {
    schemaVersion: 1,
    gate: 'L2a-fix-git-dual-arm-local',
    createdAt: new Date().toISOString(),
    taskId: 'fix-git',
    modelRef: `${PROVIDER}/${MODEL}`,
    arms: { A0: a0, B0_cold: b0 },
    deltaResolve:
      a0.reward != null && b0.reward != null ? Number(b0.reward) - Number(a0.reward) : null,
    notes: [
      'Local dual-arm runner (not full Harbor job UI) to avoid chown hang',
      'Uses host network + 127.0.0.1:8317 gateway and 127.0.0.1:7897 proxy',
      'B0_cold uses real materializeSubagentContext + buildPiChildPrompt',
    ],
  };

  await mkdir(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = join(OUT_DIR, `fix-git-dual-${stamp}.json`);
  await writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, outPath, summary }, null, 2));
  if (a0.reward == null || b0.reward == null) process.exit(2);
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
  process.exit(1);
});
