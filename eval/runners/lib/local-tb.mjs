/**
 * Shared helpers for local TB dual-arm runs (host network + proxy + gateway).
 */
import { mkdir, writeFile, readFile, cp, mkdtemp, access, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, homedir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { initProject } from '../../../src/cli/init.mjs';
import { materializeSubagentContext } from '../../../src/spawn/materialize.mjs';
import { buildPiChildPrompt } from '../../../src/spawn/pi-child.mjs';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const DEFAULT_CACHE = resolve(REPO, 'eval/cache/terminal-bench-2.0');
export const DEFAULT_CONFIG = resolve(REPO, 'eval/configs/tb-subset-v0.json');
export const DEFAULT_OUT = resolve(REPO, 'eval/out');

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ timeoutMs?: number, env?: NodeJS.ProcessEnv }} [opts]
 */
export function run(cmd, args, opts = {}) {
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

export async function loadApiKey() {
  if (process.env.CPA_OAI_API_KEY) return process.env.CPA_OAI_API_KEY;
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const j = JSON.parse(
    await readFile(join(homedir(), '.config/opencode/opencode.json'), 'utf8'),
  );
  return j.provider['cpa-oai'].options.apiKey;
}

/**
 * @param {string} configPath
 */
export async function loadSubsetConfig(configPath = DEFAULT_CONFIG) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const hash = createHash('sha256')
    .update(`${config.taskIds.join('\n')}\n`)
    .digest('hex')
    .slice(0, 16);
  if (hash !== config.taskListHash) {
    throw new Error(`taskListHash mismatch: config=${config.taskListHash} computed=${hash}`);
  }
  return config;
}

/**
 * @param {string} taskDir
 */
export async function readTaskMeta(taskDir) {
  const tom = await readFile(join(taskDir, 'task.toml'), 'utf8');
  const img = tom.match(/docker_image\s*=\s*"([^"]+)"/);
  const agentTimeout = tom.match(/\[agent\][\s\S]*?timeout_sec\s*=\s*([0-9.]+)/);
  const verifierTimeout = tom.match(/\[verifier\][\s\S]*?timeout_sec\s*=\s*([0-9.]+)/);
  let instruction = await readFile(join(taskDir, 'instruction.md'), 'utf8');
  instruction = instruction
    .split('\n')
    .filter((l) => !l.includes('BENCHMARK DATA SHOULD NEVER'))
    .join('\n')
    .trim();
  return {
    image: img ? img[1] : null,
    agentTimeoutSec: agentTimeout ? Number(agentTimeout[1]) : 900,
    verifierTimeoutSec: verifierTimeout ? Number(verifierTimeout[1]) : 900,
    instruction,
  };
}

/**
 * @param {string} image
 */
export function dockerImagePresent(image) {
  const r = spawnSync('docker', ['image', 'inspect', image], { encoding: 'utf8' });
  return r.status === 0;
}

/**
 * Pull via crane (host proxy) + docker load when dockerd cannot reach Hub.
 * @param {string} image
 * @param {{ proxy?: string }} [opts]
 */
export async function ensureImage(image, opts = {}) {
  if (dockerImagePresent(image)) {
    return { image, action: 'present' };
  }
  const proxy = opts.proxy || process.env.https_proxy || process.env.HTTPS_PROXY || 'http://127.0.0.1:7897';
  const crane = process.env.CRANE_BIN || 'crane';
  const safe = image.replace(/[/:@]/g, '_');
  const tar = join(tmpdir(), `tb-img-${safe}.tar`);
  const pull = await run(
    crane,
    ['pull', '--format', 'legacy', image, tar],
    {
      timeoutMs: 1_800_000,
      env: {
        ...process.env,
        http_proxy: proxy,
        https_proxy: proxy,
        HTTP_PROXY: proxy,
        HTTPS_PROXY: proxy,
      },
    },
  );
  if (pull.code !== 0) {
    throw new Error(`crane pull failed for ${image}: ${pull.stderr.slice(-400)}`);
  }
  const load = await run('docker', ['load', '-i', tar], { timeoutMs: 600_000 });
  if (load.code !== 0) {
    throw new Error(`docker load failed for ${image}: ${load.stderr.slice(-400)}`);
  }
  return { image, action: 'pulled', tar };
}

/**
 * Optionally bake nvm+pi+curl+uv into a task image when missing pi.
 * @param {string} image
 */
export async function ensurePiInImage(image) {
  const check = await run(
    'docker',
    [
      'run',
      '--rm',
      image,
      'bash',
      '-lc',
      ". /root/.nvm/nvm.sh 2>/dev/null || true; command -v pi && pi --version",
    ],
    { timeoutMs: 120_000 },
  );
  if (check.code === 0 && /0\.\d+\.\d+/.test(check.stdout + check.stderr)) {
    return { image, action: 'pi-present' };
  }

  const bakeDir = await mkdtemp(join(tmpdir(), 'tb-bake-'));
  const dockerfile = join(bakeDir, 'Dockerfile');
  const pin = process.env.EVOSUBAGENT_PI_NPM || '@earendil-works/pi-coding-agent@0.80.10';
  await writeFile(
    dockerfile,
    `FROM ${image}
ENV http_proxy=http://127.0.0.1:7897 https_proxy=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897 HTTPS_PROXY=http://127.0.0.1:7897 DEBIAN_FRONTEND=noninteractive
RUN apt-get update \\
 && apt-get install -y --no-install-recommends curl ca-certificates git tar \\
 && curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash \\
 && export NVM_DIR=/root/.nvm && . "$NVM_DIR/nvm.sh" \\
 && nvm install 22 \\
 && npm install -g ${pin} \\
 && pi --version \\
 && (command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/0.9.5/install.sh | sh) \\
 && apt-get clean && rm -rf /var/lib/apt/lists/*
ENV http_proxy= https_proxy= HTTP_PROXY= HTTPS_PROXY= ALL_PROXY= all_proxy=
RUN echo 'export NVM_DIR="$HOME/.nvm"' >> /root/.bashrc \\
 && echo '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"' >> /root/.bashrc
`,
  );
  const build = await run(
    'docker',
    ['build', '--network=host', '-t', image, '-f', dockerfile, bakeDir],
    { timeoutMs: 1_800_000 },
  );
  if (build.code !== 0) {
    throw new Error(`bake pi failed for ${image}: ${build.stderr.slice(-500)}`);
  }
  return { image, action: 'baked-pi' };
}

/**
 * @param {{
 *   arm: 'A0'|'B0_cold',
 *   taskId: string,
 *   taskDir: string,
 *   image: string,
 *   instruction: string,
 *   apiKey: string,
 *   provider?: string,
 *   model?: string,
 *   timeoutMs?: number,
 * }} input
 */
export async function runLocalArm(input) {
  const provider = input.provider || process.env.EVOSUBAGENT_PI_PROVIDER || 'cpa-oai';
  const model = input.model || process.env.EVOSUBAGENT_MODEL || 'grok-4.5';
  const gateway =
    process.env.EVOSUBAGENT_LOCAL_GATEWAY_URL || 'http://127.0.0.1:8317/v1';
  const proxy =
    process.env.EVOSUBAGENT_LOCAL_PROXY ||
    process.env.https_proxy ||
    'http://127.0.0.1:7897';
  const started = Date.now();

  const work = await mkdtemp(join(tmpdir(), `tb-${input.taskId}-${input.arm}-`));
  const logs = join(work, 'logs');
  await mkdir(join(logs, 'agent'), { recursive: true });
  await mkdir(join(logs, 'verifier'), { recursive: true });
  await cp(join(input.taskDir, 'tests'), join(work, 'tests'), { recursive: true });

  let prompt = input.instruction;
  /** @type {Record<string, unknown>|null} */
  let materializeMeta = null;

  if (input.arm === 'B0_cold') {
    const projectRoot = join(work, 'evo-project');
    await initProject({ projectRoot, template: 'cold-presets' });
    const mat = await materializeSubagentContext({
      projectRoot,
      subagentName: 'worker',
      task: input.instruction,
    });
    prompt = buildPiChildPrompt({
      subagentName: 'worker',
      activeVersion: mat.activeVersion,
      definitionDigest: mat.definitionDigest,
      body: mat.context.effective.body,
      task: input.instruction,
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
          [provider]: {
            baseUrl: gateway,
            api: 'openai-completions',
            apiKey: '$CPA_OAI_API_KEY',
            authHeader: true,
            compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
            models: [
              {
                id: model,
                name: `${model} (${provider})`,
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

  const keyShell = input.apiKey.replace(/'/g, `'\\''`);
  const agentCapSec = Math.max(
    120,
    Math.floor(((input.timeoutMs || 900_000) * 0.7) / 1000),
  );
  const script = `set -euo pipefail
export http_proxy='${proxy}'
export https_proxy='${proxy}'
export HTTP_PROXY=$http_proxy HTTPS_PROXY=$https_proxy
. /root/.nvm/nvm.sh 2>/dev/null || true
export CPA_OAI_API_KEY='${keyShell}'
export OPENAI_API_KEY="$CPA_OAI_API_KEY"
mkdir -p /root/.pi/agent /logs/agent /logs/verifier
cp /work/models.json /root/.pi/agent/models.json
PROMPT=$(cat /work/prompt.txt)
if [ -d /app/personal-site ]; then cd /app/personal-site
elif [ -d /workspace ]; then cd /workspace
elif [ -d /app ]; then cd /app
else cd /
fi
set +e
# Cap agent wall time; use double quotes so $PROMPT expands.
timeout ${agentCapSec}s pi --print --mode json --session-dir /logs/agent/pi-sessions \\
  --provider ${provider} --model ${model} "$PROMPT" \\
  2>&1 </dev/null | grep -v '"type":"message_update"' | tee /logs/agent/pi-out.txt
AGENT_EC=\${PIPESTATUS[0]}
set -e
if [ -f /work/tests/test.sh ]; then
  bash /work/tests/test.sh || true
fi
if [ ! -f /logs/verifier/reward.txt ]; then
  echo 0 > /logs/verifier/reward.txt
fi
echo AGENT_EC=\$AGENT_EC
exit 0
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
      input.image,
      'bash',
      '/work/run.sh',
    ],
    { timeoutMs: (input.timeoutMs || 900_000) + 60_000 },
  );

  let reward = null;
  try {
    const raw = (await readFile(join(logs, 'verifier', 'reward.txt'), 'utf8')).trim();
    reward = Number(raw);
    if (Number.isNaN(reward)) reward = null;
  } catch {
    reward = null;
  }

  return {
    arm: input.arm,
    taskId: input.taskId,
    reward,
    pass: reward === 1,
    wall_s: (Date.now() - started) / 1000,
    dockerExit: result.code,
    materialize: materializeMeta,
    modelRef: `${provider}/${model}`,
    image: input.image,
    logsDir: logs,
    workDir: work,
    error:
      reward == null
        ? `no reward.txt (dockerExit=${result.code}) stderr=${result.stderr.slice(-200)}`
        : null,
  };
}

/**
 * @param {Array<{ arm: string, taskId: string, pass?: boolean, reward?: number|null }>} results
 */
export function summarizeDelta(results) {
  /** @type {Record<string, { n: number, pass: number, rewards: number[] }>} */
  const byArm = {};
  for (const r of results) {
    const b = (byArm[r.arm] ??= { n: 0, pass: 0, rewards: [] });
    b.n += 1;
    if (r.pass || r.reward === 1) b.pass += 1;
    if (typeof r.reward === 'number') b.rewards.push(r.reward);
  }
  /** @type {Record<string, { n: number, pass: number, passRate: number }>} */
  const arms = {};
  for (const [arm, s] of Object.entries(byArm)) {
    arms[arm] = {
      n: s.n,
      pass: s.pass,
      passRate: s.n ? s.pass / s.n : 0,
    };
  }
  const a0 = arms.A0?.passRate;
  const b0 = arms.B0_cold?.passRate;
  return {
    arms,
    deltaResolve: a0 != null && b0 != null ? b0 - a0 : null,
  };
}
