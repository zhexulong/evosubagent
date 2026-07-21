#!/usr/bin/env node
/**
 * L2a Terminal-Bench subset runner (Harbor).
 *
 * Arms:
 *   A0      — eval.harbor_agents.pi_a0:PiA0
 *   B0_cold — eval.harbor_agents.pi_b0_cold:PiB0Cold
 *
 * Model default: cpa-oai/grok-4.5 (same as L1 smoke).
 *
 * Usage:
 *   node eval/runners/tb-subset.mjs --dry-run
 *   node eval/runners/tb-subset.mjs --arm A0 --task fix-git
 *   node eval/runners/tb-subset.mjs --arm both --limit 2
 *   node eval/runners/tb-subset.mjs --arm both          # full frozen 16
 *
 * Requires: harbor on PATH, Docker + compose, gateway at host.docker.internal:8317
 * Dataset:  eval/cache/terminal-bench-2.0 (harbor dataset download)
 */
import { readFile, mkdir, writeFile, access, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const CONFIG_PATH = join(REPO, 'eval/configs/tb-subset-v0.json');
const JOBS_DIR = join(REPO, 'eval/jobs');
const OUT_DIR = join(REPO, 'eval/out');
const CACHE_DEFAULT = join(REPO, 'eval/cache/terminal-bench-2.0');

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean | number>} */
  const out = { _: [] };
  const rest = /** @type {string[]} */ (out._);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else rest.push(a);
  }
  return out;
}

function printHelp() {
  console.log(`tb-subset — L2a Harbor runner (A0 vs B0_cold)

Usage:
  node eval/runners/tb-subset.mjs --dry-run
  node eval/runners/tb-subset.mjs --arm A0|B0_cold|both [--task id] [--limit N]
  node eval/runners/tb-subset.mjs --arm both --include fix-git,prove-plus-comm

Env:
  CPA_OAI_API_KEY / OPENAI_API_KEY   gateway key (or load from OpenCode config)
  EVOSUBAGENT_GATEWAY_URL            default http://host.docker.internal:8317/v1
  EVOSUBAGENT_MODEL                  default grok-4.5
  EVOSUBAGENT_PI_PROVIDER            default cpa-oai
  HARBOR_BIN                         default harbor
`);
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 */
function run(cmd, args, env = process.env) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, {
      cwd: REPO,
      env: { ...env, PYTHONPATH: REPO },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      const s = String(d);
      stdout += s;
      process.stdout.write(s);
    });
    child.stderr.on('data', (d) => {
      const s = String(d);
      stderr += s;
      process.stderr.write(s);
    });
    child.on('close', (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function loadOpenCodeKey() {
  try {
    const p = join(homedir(), '.config/opencode/opencode.json');
    const j = JSON.parse(await readFile(p, 'utf8'));
    return j?.provider?.['cpa-oai']?.options?.apiKey || '';
  } catch {
    return '';
  }
}

/**
 * @param {unknown} resultJson
 */
function extractArmStats(resultJson) {
  if (!resultJson || typeof resultJson !== 'object') {
    return { nTrials: 0, nErrors: 0, mean: null, passRate: null };
  }
  const stats = /** @type {Record<string, unknown>} */ (resultJson).stats;
  if (!stats || typeof stats !== 'object') {
    return { nTrials: 0, nErrors: 0, mean: null, passRate: null };
  }
  const s = /** @type {Record<string, unknown>} */ (stats);
  const evals = s.evals && typeof s.evals === 'object' ? /** @type {Record<string, unknown>} */ (s.evals) : {};
  const first = Object.values(evals)[0];
  if (!first || typeof first !== 'object') {
    return {
      nTrials: Number(s.n_completed_trials ?? 0),
      nErrors: Number(s.n_errored_trials ?? 0),
      mean: null,
      passRate: null,
    };
  }
  const e = /** @type {Record<string, unknown>} */ (first);
  const metrics = Array.isArray(e.metrics) ? e.metrics : [];
  const meanMetric = metrics.find((m) => m && typeof m === 'object' && 'mean' in /** @type {object} */ (m));
  const mean =
    meanMetric && typeof meanMetric === 'object'
      ? Number(/** @type {{ mean?: number }} */ (meanMetric).mean)
      : null;
  const nTrials = Number(e.n_trials ?? 0);
  const nErrors = Number(e.n_errors ?? 0);
  return {
    nTrials,
    nErrors,
    mean,
    passRate: mean,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  /** @type {string[]} */
  let taskIds = [...config.taskIds];
  const listHash = createHash('sha256').update(`${taskIds.join('\n')}\n`).digest('hex').slice(0, 16);
  if (listHash !== config.taskListHash) {
    console.error(
      JSON.stringify({
        ok: false,
        error: `taskListHash mismatch: config=${config.taskListHash} computed=${listHash}`,
      }),
    );
    process.exit(1);
  }

  if (typeof args.include === 'string') {
    const set = new Set(String(args.include).split(',').map((s) => s.trim()).filter(Boolean));
    taskIds = taskIds.filter((id) => set.has(id));
  }
  if (typeof args.task === 'string') {
    taskIds = taskIds.filter((id) => id === args.task);
  }
  if (args.limit && Number(args.limit) > 0) {
    taskIds = taskIds.slice(0, Number(args.limit));
  }

  const armArg = String(args.arm ?? 'both');
  /** @type {string[]} */
  const arms =
    armArg === 'both' ? ['A0', 'B0_cold'] : armArg === 'A0' || armArg === 'B0_cold' ? [armArg] : [];
  if (arms.length === 0) {
    console.error(JSON.stringify({ ok: false, error: `unknown --arm ${armArg}` }));
    process.exit(1);
  }

  const datasetPath = String(args.datasetPath ?? config.harbor?.datasetLocalCache ?? CACHE_DEFAULT);
  const datasetAbs = resolve(REPO, datasetPath);

  if (args.dryRun) {
    const report = {
      ok: true,
      mode: 'dry-run',
      config: config.name,
      benchVersion: config.benchVersion,
      taskListHash: config.taskListHash,
      modelRef: config.model.ref,
      arms,
      taskIds,
      datasetPath: datasetAbs,
      harborCommands: arms.map((arm) => {
        const agent = config.arms[arm].agent;
        return {
          arm,
          agent,
          cmd: [
            'harbor',
            'run',
            '-p',
            datasetAbs,
            ...taskIds.flatMap((id) => ['-i', id]),
            '-a',
            agent,
            '-m',
            config.model.ref,
            '-n',
            '1',
            '-o',
            'eval/jobs',
            '--job-name',
            `l2a-${arm.toLowerCase()}`,
            '-y',
          ].join(' '),
        };
      }),
      notes: [
        'Docker Hub must be reachable to pull task images',
        'Gateway must be reachable as host.docker.internal:8317 from containers',
        'Set CPA_OAI_API_KEY or use OpenCode cpa-oai key via live loader',
      ],
    };
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Ensure dataset exists
  try {
    await access(datasetAbs);
  } catch {
    console.error(
      JSON.stringify({
        ok: false,
        error: `dataset missing at ${datasetAbs}; run: harbor dataset download terminal-bench@2.0 -o eval/cache && mv eval/cache/terminal-bench eval/cache/terminal-bench-2.0`,
      }),
    );
    process.exit(1);
  }

  if (!process.env.CPA_OAI_API_KEY && !process.env.OPENAI_API_KEY) {
    const k = await loadOpenCodeKey();
    if (k) process.env.CPA_OAI_API_KEY = k;
  }
  if (!process.env.CPA_OAI_API_KEY && !process.env.OPENAI_API_KEY) {
    console.error(JSON.stringify({ ok: false, error: 'missing CPA_OAI_API_KEY / OPENAI_API_KEY' }));
    process.exit(1);
  }

  process.env.EVOSUBAGENT_GATEWAY_URL =
    process.env.EVOSUBAGENT_GATEWAY_URL || config.model.gatewayHostDefault;
  process.env.EVOSUBAGENT_PI_PROVIDER =
    process.env.EVOSUBAGENT_PI_PROVIDER || config.model.provider;
  process.env.EVOSUBAGENT_MODEL = process.env.EVOSUBAGENT_MODEL || config.model.modelId;
  process.env.PYTHONPATH = REPO;

  const harborBin = process.env.HARBOR_BIN || 'harbor';
  await mkdir(JOBS_DIR, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  /** @type {Record<string, unknown>} */
  const armResults = {};

  for (const arm of arms) {
    const agent = config.arms[arm].agent;
    const jobName = `l2a-${arm.toLowerCase()}-${stamp}`;
    const includeArgs = taskIds.flatMap((id) => ['-i', id]);
    const cmdArgs = [
      'run',
      '-p',
      datasetAbs,
      ...includeArgs,
      '-a',
      agent,
      '-m',
      config.model.ref,
      '-n',
      String(args.concurrent ?? 1),
      '-o',
      JOBS_DIR,
      '--job-name',
      jobName,
      '-y',
      // allow host gateway
      '--allow-agent-host',
      'host.docker.internal',
      '--ae',
      `CPA_OAI_API_KEY=${process.env.CPA_OAI_API_KEY || process.env.OPENAI_API_KEY}`,
      '--ae',
      `EVOSUBAGENT_GATEWAY_URL=${process.env.EVOSUBAGENT_GATEWAY_URL}`,
      '--ae',
      `OPENAI_API_KEY=${process.env.CPA_OAI_API_KEY || process.env.OPENAI_API_KEY}`,
    ];

    console.error(`\n=== arm ${arm} → ${agent} (${taskIds.length} tasks) ===\n`);
    const started = Date.now();
    const result = await run(harborBin, cmdArgs, process.env);
    const wall_s = (Date.now() - started) / 1000;
    const resultPath = join(JOBS_DIR, jobName, 'result.json');
    let harborResult = null;
    try {
      harborResult = JSON.parse(await readFile(resultPath, 'utf8'));
    } catch {
      harborResult = null;
    }
    armResults[arm] = {
      role: config.arms[arm].role,
      agent,
      jobName,
      jobDir: join(JOBS_DIR, jobName),
      exitCode: result.code,
      wall_s,
      stats: extractArmStats(harborResult),
      harborResult,
    };
  }

  const a0 = /** @type {{ stats?: { passRate?: number|null } }} */ (armResults.A0);
  const b0 = /** @type {{ stats?: { passRate?: number|null } }} */ (armResults.B0_cold);
  const delta =
    a0?.stats?.passRate != null && b0?.stats?.passRate != null
      ? Number(b0.stats.passRate) - Number(a0.stats.passRate)
      : null;

  const summary = {
    schemaVersion: 1,
    gate: 'L2a-tb-subset',
    id: `tb-subset-${stamp}`,
    createdAt: new Date().toISOString(),
    config: config.name,
    bench: config.bench,
    benchVersion: config.benchVersion,
    taskListHash: config.taskListHash,
    taskIds,
    modelRef: config.model.ref,
    piPin: config.harbor.piVersionPin,
    arms: armResults,
    deltaResolve: delta,
    notes: [
      'ΔResolve = pass(B0_cold) - pass(A0); null if an arm missing or failed to score',
      'Do not mix with mini-bench B_mech',
    ],
  };

  const outPath = join(OUT_DIR, `tb-subset-${stamp}.json`);
  await writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, outPath, summary }, null, 2));

  // Fail if any arm hard-failed with no trials (infra)
  const infraFail = Object.values(armResults).some((r) => {
    const x = /** @type {{ stats?: { nTrials?: number, nErrors?: number }, exitCode?: number }} */ (r);
    return (x.stats?.nTrials ?? 0) === 0 && (x.stats?.nErrors ?? 0) > 0;
  });
  if (infraFail) process.exit(2);
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
  process.exit(1);
});
