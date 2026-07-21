#!/usr/bin/env node
/**
 * Mini local hermetic harness (docs/13 arm semantics).
 *
 * Arms:
 * - A0: no EvoSubagent (control placeholders)
 * - B0_cold: EvoSubagent cold template only (no evolve). echo-new expected fail on default OLD body.
 * - B_mech: host evolve → NEW: then invoke (mechanism / materialize proof — not outcome Δ).
 *
 * Do NOT market "A0 vs B0 Δ" from B_mech. B0_cold is the cold arm.
 *
 * Output: eval/out/mini-<stamp>.json
 */
import { mkdir, writeFile, readdir, chmod, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { initProject } from '../../src/cli/init.mjs';
import { invokeSubagent } from '../../src/spawn/invoke.mjs';
import { applyEvolutionPatch, loadVersionState } from '../../src/evolve/apply.mjs';
import { createAcceptedPatch } from '../../src/evolve/patch.mjs';
import { loadSubagentDefinition } from '../../src/define/load.mjs';
import { mergeSubagentLayers } from '../../src/layers/merge.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EVAL_ROOT = resolve(HERE, '..');
const REPO_ROOT = resolve(EVAL_ROOT, '..');
const FIXTURES = join(EVAL_ROOT, 'fixtures', 'mini-repo-tasks');
const OUT_DIR = join(EVAL_ROOT, 'out');

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 */
function run(cmd, args, env) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env }, cwd: REPO_ROOT });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.on('close', (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * @param {string} taskDir
 * @param {Record<string, string>} env
 */
async function runTaskTests(taskDir, env) {
  const script = join(taskDir, 'tests', 'test.sh');
  await chmod(script, 0o755);
  return run('bash', [script], env);
}

/**
 * @param {string[]} taskNames
 * @param {{ body: string, desc: string, ver: string }} files
 * @param {string} scratch
 */
async function scoreTasks(taskNames, files, scratch) {
  /** @type {{ id: string, pass: boolean, detail: string }[]} */
  const tasks = [];
  const bodyFile = join(scratch, 'body.txt');
  const descFile = join(scratch, 'desc.txt');
  const verFile = join(scratch, 'ver.txt');
  await writeFile(bodyFile, `${files.body}\n`, 'utf8');
  await writeFile(descFile, `${files.desc}\n`, 'utf8');
  await writeFile(verFile, `${files.ver}\n`, 'utf8');
  for (const id of taskNames) {
    const taskDir = join(FIXTURES, id);
    const result = await runTaskTests(taskDir, {
      EVOSUBAGENT_BODY_FILE: bodyFile,
      EVOSUBAGENT_DESC_FILE: descFile,
      EVOSUBAGENT_VERSION_FILE: verFile,
    });
    tasks.push({
      id,
      pass: result.code === 0,
      detail: (result.stdout || result.stderr).trim().slice(0, 200),
    });
  }
  return tasks;
}

/** A0: control without EvoSubagent */
async function runArmA0(taskNames) {
  const scratch = join(tmpdir(), `mini-a0-${Date.now()}`);
  await mkdir(scratch, { recursive: true });
  try {
    return await scoreTasks(
      taskNames,
      {
        body: 'body with OLD: control arm',
        desc: 'Use when controlling A0 baseline.',
        ver: '1',
      },
      scratch,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * B0_cold: template only, no evolve. Default echo-policy body uses OLD: → echo-new fails.
 */
async function runArmB0Cold(taskNames) {
  const projectRoot = join(tmpdir(), `mini-b0-cold-${Date.now()}`);
  await mkdir(projectRoot, { recursive: true });
  try {
    await initProject({ projectRoot, template: 'echo-policy' });
    const name = 'echo-policy';
    const invoked = await invokeSubagent({
      projectRoot,
      subagentName: name,
      task: 'mini-bench cold invoke',
      runtime: 'pi-first-stub',
    });
    const scratch = join(projectRoot, '_bench_files');
    await mkdir(scratch, { recursive: true });
    return await scoreTasks(
      taskNames,
      {
        body: invoked.materialized.context.effective.body,
        desc: invoked.materialized.context.effective.description,
        ver: String(invoked.materialized.activeVersion ?? invoked.record.activeVersion),
      },
      scratch,
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

/**
 * B_mech: host evolve then invoke — mechanism/materialize proof, not cold outcome arm.
 */
async function runArmBMech(taskNames) {
  const projectRoot = join(tmpdir(), `mini-b-mech-${Date.now()}`);
  await mkdir(projectRoot, { recursive: true });
  try {
    await initProject({ projectRoot, template: 'echo-policy' });
    const name = 'echo-policy';
    const base = await loadSubagentDefinition(projectRoot, name);
    const versionState = await loadVersionState(projectRoot, name);
    const merged = mergeSubagentLayers({ base, versionState });
    await applyEvolutionPatch({
      projectRoot,
      patch: createAcceptedPatch({
        subagentName: name,
        correction: 'mini-bench mechanism NEW prefix',
        beforeText: merged.effective.body,
        afterText: 'body with NEW: mini-bench mechanism arm rule',
      }),
    });
    const invoked = await invokeSubagent({
      projectRoot,
      subagentName: name,
      task: 'mini-bench mechanism invoke',
      runtime: 'pi-first-stub',
    });
    const scratch = join(projectRoot, '_bench_files');
    await mkdir(scratch, { recursive: true });
    return await scoreTasks(
      taskNames,
      {
        body: invoked.materialized.context.effective.body,
        desc: invoked.materialized.context.effective.description,
        ver: String(invoked.materialized.activeVersion ?? invoked.record.activeVersion),
      },
      scratch,
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

async function main() {
  const entries = await readdir(FIXTURES, { withFileTypes: true });
  const taskNames = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  if (taskNames.length === 0) {
    throw new Error('no mini-repo-tasks found');
  }

  const a0 = await runArmA0(taskNames);
  const b0Cold = await runArmB0Cold(taskNames);
  const bMech = await runArmBMech(taskNames);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const report = {
    schemaVersion: 1,
    id: `mini-${stamp}`,
    createdAt: new Date().toISOString(),
    harness: 'mini-repo-tasks',
    note:
      'B0_cold = cold template (no evolve). B_mech = host evolve then materialize (mechanism). Do not report B_mech as cold Δ.',
    repoCommit: process.env.GIT_COMMIT ?? null,
    arms: {
      A0: { role: 'control', tasks: a0 },
      B0_cold: { role: 'cold-subagent', tasks: b0Cold },
      B_mech: { role: 'mechanism-after-evolve', tasks: bMech },
    },
  };

  await mkdir(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `mini-${stamp}.json`);
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, outPath, report }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error?.message ?? error) }, null, 2));
  process.exit(1);
});
