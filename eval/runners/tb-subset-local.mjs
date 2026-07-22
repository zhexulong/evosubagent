#!/usr/bin/env node
/**
 * Local multi-task TB subset runner (L2a): A0 vs B0_cold + ΔResolve summary.
 *
 * Uses host network so containers can reach:
 *   - gateway 127.0.0.1:8317 (OpenCode cpa-oai)
 *   - proxy   127.0.0.1:7897 (optional, for apt/uv in verifier)
 *
 * B0_cold always calls materializeSubagentContext + buildPiChildPrompt (no evolve).
 *
 * Usage:
 *   node eval/runners/tb-subset-local.mjs --dry-run
 *   node eval/runners/tb-subset-local.mjs --task fix-git
 *   node eval/runners/tb-subset-local.mjs --limit 2
 *   node eval/runners/tb-subset-local.mjs --arm both
 *   node eval/runners/tb-subset-local.mjs --ensure-images   # crane pull missing
 *   node eval/runners/tb-subset-local.mjs --bake-pi         # bake pi into images missing it
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  DEFAULT_CACHE,
  DEFAULT_CONFIG,
  DEFAULT_OUT,
  REPO,
  dockerImagePresent,
  ensureImage,
  ensurePiInImage,
  loadApiKey,
  loadSubsetConfig,
  readTaskMeta,
  runLocalArm,
  summarizeDelta,
} from './lib/local-tb.mjs';

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean | number>} */
  const out = { _: [] };
  const rest = /** @type {string[]} */ (out._);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--ensure-images') out.ensureImages = true;
    else if (a === '--bake-pi') out.bakePi = true;
    else if (a === '--skip-missing-images') out.skipMissingImages = true;
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
  console.log(`tb-subset-local — multi-task A0 vs B0_cold (local docker host-network)

Usage:
  node eval/runners/tb-subset-local.mjs --dry-run
  node eval/runners/tb-subset-local.mjs --task fix-git
  node eval/runners/tb-subset-local.mjs --limit 3 --arm both
  node eval/runners/tb-subset-local.mjs --ensure-images --bake-pi --limit 2

Flags:
  --arm A0|B0_cold|both   default both
  --task <id>             single task from frozen list
  --include a,b,c         filter frozen list
  --limit N               first N after filters
  --ensure-images         crane pull + docker load missing images (uses host proxy)
  --bake-pi               bake nvm+pi into images missing pi
  --skip-missing-images   skip tasks whose image is not local (instead of failing)
  --dry-run               plan only

Env:
  CPA_OAI_API_KEY / OPENAI_API_KEY
  EVOSUBAGENT_MODEL (default grok-4.5)
  EVOSUBAGENT_PI_PROVIDER (default cpa-oai)
  EVOSUBAGENT_LOCAL_GATEWAY_URL (default http://127.0.0.1:8317/v1)
  EVOSUBAGENT_LOCAL_PROXY (default http://127.0.0.1:7897)
  CRANE_BIN
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const config = await loadSubsetConfig(
    typeof args.config === 'string' ? resolve(String(args.config)) : DEFAULT_CONFIG,
  );
  const cache = resolve(
    REPO,
    typeof args.datasetPath === 'string'
      ? String(args.datasetPath)
      : config.harbor?.datasetLocalCache || DEFAULT_CACHE,
  );

  try {
    await access(cache);
  } catch {
    throw new Error(
      `dataset cache missing: ${cache} (harbor dataset download terminal-bench@2.0)`,
    );
  }

  /** @type {string[]} */
  let taskIds = [...config.taskIds];
  if (typeof args.include === 'string') {
    const set = new Set(
      String(args.include)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    taskIds = taskIds.filter((id) => set.has(id));
  }
  if (typeof args.task === 'string') {
    taskIds = taskIds.filter((id) => id === args.task);
  }
  if (args.limit && Number(args.limit) > 0) {
    taskIds = taskIds.slice(0, Number(args.limit));
  }
  if (taskIds.length === 0) throw new Error('no tasks selected');

  const armArg = String(args.arm ?? 'both');
  /** @type {Array<'A0'|'B0_cold'>} */
  const arms =
    armArg === 'both'
      ? ['A0', 'B0_cold']
      : armArg === 'A0' || armArg === 'B0_cold'
        ? [/** @type {'A0'|'B0_cold'} */ (armArg)]
        : [];
  if (arms.length === 0) throw new Error(`unknown --arm ${armArg}`);

  /** @type {Array<{ taskId: string, image: string|null, present: boolean }>} */
  const plan = [];
  for (const taskId of taskIds) {
    const taskDir = join(cache, taskId);
    const meta = await readTaskMeta(taskDir);
    plan.push({
      taskId,
      image: meta.image,
      present: meta.image ? dockerImagePresent(meta.image) : false,
    });
  }

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: 'dry-run',
          config: config.name,
          taskListHash: config.taskListHash,
          modelRef: config.model.ref,
          arms,
          tasks: plan,
          missingImages: plan.filter((p) => p.image && !p.present).map((p) => p.image),
        },
        null,
        2,
      ),
    );
    return;
  }

  const apiKey = await loadApiKey();
  if (!apiKey) throw new Error('missing CPA_OAI_API_KEY / OPENAI_API_KEY');

  /** @type {Awaited<ReturnType<typeof runLocalArm>>[]} */
  const results = [];
  /** @type {string[]} */
  const skipped = [];

  for (const item of plan) {
    if (!item.image) {
      skipped.push(`${item.taskId}:no-image`);
      continue;
    }
    if (!dockerImagePresent(item.image)) {
      if (args.ensureImages) {
        process.stderr.write(`pull ${item.image}...\n`);
        await ensureImage(item.image);
      } else if (args.skipMissingImages) {
        skipped.push(`${item.taskId}:missing-image`);
        continue;
      } else {
        throw new Error(
          `image not local: ${item.image} (use --ensure-images or --skip-missing-images)`,
        );
      }
    }
    if (args.bakePi) {
      process.stderr.write(`ensure pi in ${item.image}...\n`);
      await ensurePiInImage(item.image);
    }

    const taskDir = join(cache, item.taskId);
    const meta = await readTaskMeta(taskDir);
    const timeoutMs = Math.max(meta.agentTimeoutSec, meta.verifierTimeoutSec) * 1000 + 120_000;

    for (const arm of arms) {
      process.stderr.write(`\n=== ${arm} / ${item.taskId} ===\n`);
      const r = await runLocalArm({
        arm,
        taskId: item.taskId,
        taskDir,
        image: item.image,
        instruction: meta.instruction,
        apiKey,
        provider: config.model.provider,
        model: config.model.modelId,
        timeoutMs,
      });
      results.push(r);
      process.stderr.write(
        `→ reward=${r.reward} wall_s=${r.wall_s.toFixed(1)} ${r.error ? r.error : 'ok'}\n`,
      );
    }
  }

  const delta = summarizeDelta(results);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const summary = {
    schemaVersion: 1,
    gate: 'L2a-tb-subset-local',
    id: `tb-local-${stamp}`,
    createdAt: new Date().toISOString(),
    config: config.name,
    benchVersion: config.benchVersion,
    taskListHash: config.taskListHash,
    modelRef: config.model.ref,
    selectedTaskIds: taskIds,
    skipped,
    results,
    summary: delta,
    notes: [
      'ΔResolve = passRate(B0_cold) - passRate(A0) on completed tasks',
      'B0_cold uses real materialize (no evolve)',
      'Local host-network runner (not full Harbor job UI)',
    ],
  };

  await mkdir(DEFAULT_OUT, { recursive: true });
  const outPath = join(DEFAULT_OUT, `tb-local-${stamp}.json`);
  await writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`);

  // also print compact table
  const table = {
    ok: true,
    outPath,
    modelRef: summary.modelRef,
    taskListHash: summary.taskListHash,
    nTasksPlanned: taskIds.length,
    nResults: results.length,
    skipped,
    passRates: delta.arms,
    deltaResolve: delta.deltaResolve,
    perTask: taskIds.map((tid) => {
      const a0 = results.find((r) => r.taskId === tid && r.arm === 'A0');
      const b0 = results.find((r) => r.taskId === tid && r.arm === 'B0_cold');
      return {
        taskId: tid,
        A0: a0?.reward ?? null,
        B0_cold: b0?.reward ?? null,
        B0_materialize: b0?.materialize?.activeVersion ?? null,
      };
    }),
  };
  console.log(JSON.stringify(table, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
  process.exit(1);
});
