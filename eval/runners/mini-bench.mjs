#!/usr/bin/env node
/**
 * Mini local A0 vs B0 bench (hermetic).
 * - A0: no EvoSubagent materialize (control fixtures)
 * - B0: EvoSubagent cold invoke on scaffolded project
 *
 * Output: eval/out/mini-<stamp>.json
 */
import { mkdir, writeFile, readdir, readFile, chmod, cp, rm } from 'node:fs/promises';
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
 * A0: control without EvoSubagent — empty body / weak description fail echo-new,
 * routing-desc and version-pin may still pass on canned files if we choose.
 * For fairness, A0 uses non-evosubagent placeholder files.
 */
async function runArmA0(taskNames) {
  /** @type {{ id: string, pass: boolean, detail: string }[]} */
  const tasks = [];
  const scratch = join(tmpdir(), `mini-a0-${Date.now()}`);
  await mkdir(scratch, { recursive: true });
  try {
    for (const id of taskNames) {
      const taskDir = join(FIXTURES, id);
      const bodyFile = join(scratch, `${id}.body`);
      const descFile = join(scratch, `${id}.desc`);
      const verFile = join(scratch, `${id}.ver`);
      // Control: old-style body, non-routing desc for first task, empty-ish for contrast
      await writeFile(bodyFile, 'body with OLD: control arm\n', 'utf8');
      await writeFile(descFile, 'Use when controlling A0 baseline.\n', 'utf8');
      await writeFile(verFile, '1\n', 'utf8');
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
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return tasks;
}

/**
 * B0: cold EvoSubagent — init template + optional body patch so echo-new can pass.
 * Still "cold" relative to TB: no train split; one host correction to exercise materialize.
 */
async function runArmB0(taskNames) {
  /** @type {{ id: string, pass: boolean, detail: string }[]} */
  const tasks = [];
  const projectRoot = join(tmpdir(), `mini-b0-${Date.now()}`);
  await mkdir(projectRoot, { recursive: true });
  try {
    await initProject({ projectRoot, template: 'echo-policy' });
    const name = 'echo-policy';
    // Stage mini: apply one host correction so body has NEW: (materialize proof on cold defs)
    const base = await loadSubagentDefinition(projectRoot, name);
    const versionState = await loadVersionState(projectRoot, name);
    const merged = mergeSubagentLayers({ base, versionState });
    await applyEvolutionPatch({
      projectRoot,
      patch: createAcceptedPatch({
        subagentName: name,
        correction: 'mini-bench NEW prefix',
        beforeText: merged.effective.body,
        afterText: 'body with NEW: mini-bench cold arm rule',
      }),
    });
    const invoked = await invokeSubagent({
      projectRoot,
      subagentName: name,
      task: 'mini-bench invoke',
    });
    const body = invoked.materialized.context.effective.body;
    const desc = invoked.materialized.context.effective.description;
    const ver = invoked.materialized.activeVersion ?? invoked.record.activeVersion;

    const scratch = join(projectRoot, '_bench_files');
    await mkdir(scratch, { recursive: true });
    const bodyFile = join(scratch, 'body.txt');
    const descFile = join(scratch, 'desc.txt');
    const verFile = join(scratch, 'ver.txt');
    await writeFile(bodyFile, `${body}\n`, 'utf8');
    await writeFile(descFile, `${desc}\n`, 'utf8');
    await writeFile(verFile, `${ver}\n`, 'utf8');

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
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
  return tasks;
}

async function main() {
  const entries = await readdir(FIXTURES, { withFileTypes: true });
  const taskNames = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  if (taskNames.length === 0) {
    throw new Error('no mini-repo-tasks found');
  }

  const a0 = await runArmA0(taskNames);
  const b0 = await runArmB0(taskNames);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const report = {
    schemaVersion: 1,
    id: `mini-${stamp}`,
    createdAt: new Date().toISOString(),
    harness: 'mini-repo-tasks',
    repoCommit: process.env.GIT_COMMIT ?? null,
    arms: {
      A0: { tasks: a0 },
      B0: { tasks: b0 },
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
