#!/usr/bin/env node
import { resolve } from 'node:path';
import { invokeSubagent } from '../spawn/invoke.mjs';
import { applyEvolutionPatch, loadVersionState } from '../evolve/apply.mjs';
import { createAcceptedPatch } from '../evolve/patch.mjs';
import { revertEvolutionPatch } from '../evolve/revert.mjs';
import { revertToVersion } from '../evolve/revert-to.mjs';
import { loadSubagentDefinition } from '../define/load.mjs';
import { mergeSubagentLayers } from '../layers/merge.mjs';
import { runCorrectOnceDemo } from './demo-correct-once.mjs';
import { runB1Demo } from './demo-b1.mjs';
import { initProject } from './init.mjs';
import { readRunRecord } from '../ledger/run.mjs';
import { listRunHistory } from './history.mjs';
import { correctFromRun } from './correct.mjs';
import {
  listSubagents,
  showRun,
  listVersionHistory,
  diffSubagent,
} from './inspect.mjs';

function printHelp() {
  console.log(`evosubagent — teach coding agents once; versioned rules for future runs

Usage:
  evosubagent init --project <path> [--template echo-policy|worker|cold-presets]
  evosubagent list --project <path>
  evosubagent invoke --project <path> --name <subagent> --task <text> [--runtime pi-first-stub|pi-child]
  evosubagent history --project <path> [--name <subagent>] [--limit N]
  evosubagent show-run --project <path> --run-id <id> [--full]
  evosubagent versions --project <path> --name <subagent>
  evosubagent diff --project <path> --name <subagent> [--patch-id <id>]
  evosubagent correct --project <path> --name <subagent> --correction <text> --after-body <text> [--from-run <runId>]
  evosubagent evolve --project <path> --name <subagent> --correction <text> --after-body <text> [--from-run <runId>]
  evosubagent revert --project <path> --name <subagent> (--to <version> | --patch-id <id>)
  evosubagent doctor --project <path> --name <subagent>
  evosubagent demo correct-once|b1 --project <path>
  evosubagent --help

Everyday:
  history / show-run / versions / diff  — trust loop (what ran, what changed)
  correct --from-run                    — preferred over evolve for product demos
  revert --to <version>                 — user-facing rollback (still records patch ids)

Note: --after-body still required for correct/evolve (proposal-from-NL is next).
Runs under .evosubagent/runs are gitignored; do not paste secrets into PRs.
`);
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = { _: [] };
  const rest = /** @type {string[]} */ (out._);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
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

async function cmdInvoke(args) {
  const projectRoot = resolve(String(args.project ?? '.'));
  const name = String(args.name ?? '');
  const task = String(args.task ?? '');
  const runtimeArg = args.runtime;
  const runtime =
    runtimeArg === 'pi-child' || runtimeArg === 'pi-first-stub'
      ? runtimeArg
      : undefined;
  const result = await invokeSubagent({
    projectRoot,
    subagentName: name,
    task,
    runtime,
  });
  const payload = {
    ok: result.ok,
    runRef: result.runRef,
    record: result.record,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (!result.ok) process.exit(1);
}

async function cmdEvolve(args) {
  const projectRoot = resolve(String(args.project ?? '.'));
  const name = String(args.name ?? '');
  const correction = String(args.correction ?? '');
  const afterBody = String(args['after-body'] ?? args.afterBody ?? '');
  const fromRun = args['from-run'] ?? args.fromRun;
  if (!name || !correction || !afterBody) {
    throw new Error('evolve requires --name, --correction, --after-body');
  }
  const base = await loadSubagentDefinition(projectRoot, name);
  const versionState = await loadVersionState(projectRoot, name);
  const merged = mergeSubagentLayers({ base, versionState });
  /** @type {string[]} */
  const sourceRefs = ['cli:evolve'];
  if (fromRun && fromRun !== true) {
    const runId = String(fromRun);
    const { record } = await readRunRecord(projectRoot, runId);
    sourceRefs.push(runId);
    if (record.definitionDigest) sourceRefs.push(`digest:${record.definitionDigest}`);
    if (record.task) sourceRefs.push(`task:${String(record.task).slice(0, 120)}`);
  }
  const patch = createAcceptedPatch({
    subagentName: name,
    targetKind: 'subagent-body',
    correction,
    beforeText: merged.effective.body,
    afterText: afterBody,
    sourceRefs,
  });
  const applied = await applyEvolutionPatch({ projectRoot, patch, actorRef: 'cli' });
  console.log(
    JSON.stringify(
      {
        ok: true,
        patchRef: applied.patchRef,
        versionRef: applied.versionRef,
        previousVersion: applied.previousVersionState.version,
        nextVersion: applied.nextVersionState.version,
        sourceRefs: applied.appliedPatch.sourceRefs,
      },
      null,
      2,
    ),
  );
}

async function cmdRevert(args) {
  const projectRoot = resolve(String(args.project ?? '.'));
  const name = String(args.name ?? '');
  const toVersion =
    args.to && args.to !== true
      ? String(args.to)
      : args['to-version'] && args['to-version'] !== true
        ? String(args['to-version'])
        : undefined;
  const patchId =
    args['patch-id'] && args['patch-id'] !== true
      ? String(args['patch-id'])
      : args.patchId && args.patchId !== true
        ? String(args.patchId)
        : undefined;
  if (!name) throw new Error('revert requires --name');
  if (toVersion) {
    const result = await revertToVersion({
      projectRoot,
      subagentName: name,
      toVersion,
      actorRef: 'cli',
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (!patchId) {
    throw new Error('revert requires --to <version> or --patch-id <id>');
  }
  const result = await revertEvolutionPatch({
    projectRoot,
    subagentName: name,
    patchId,
    actorRef: 'cli',
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        patchRef: result.patchRef,
        versionRef: result.versionRef,
        restoredVersion: result.restoredVersionState.version,
        patchStatus: result.appliedPatch.status,
      },
      null,
      2,
    ),
  );
}

async function cmdList(args) {
  const projectRoot = resolve(String(args.project ?? '.'));
  console.log(JSON.stringify(await listSubagents({ projectRoot }), null, 2));
}

async function cmdShowRun(args) {
  const projectRoot = resolve(String(args.project ?? '.'));
  const runId = String(args['run-id'] ?? args.runId ?? '');
  if (!runId) throw new Error('show-run requires --run-id');
  console.log(
    JSON.stringify(
      await showRun({ projectRoot, runId, full: args.full === true }),
      null,
      2,
    ),
  );
}

async function cmdVersions(args) {
  const projectRoot = resolve(String(args.project ?? '.'));
  const name = String(args.name ?? '');
  if (!name) throw new Error('versions requires --name');
  const limit = args.limit && args.limit !== true ? Number(args.limit) : 20;
  console.log(
    JSON.stringify(await listVersionHistory({ projectRoot, name, limit }), null, 2),
  );
}

async function cmdDiff(args) {
  const projectRoot = resolve(String(args.project ?? '.'));
  const name = String(args.name ?? '');
  if (!name) throw new Error('diff requires --name');
  const patchId =
    args['patch-id'] && args['patch-id'] !== true
      ? String(args['patch-id'])
      : args.patchId && args.patchId !== true
        ? String(args.patchId)
        : undefined;
  console.log(
    JSON.stringify(await diffSubagent({ projectRoot, name, patchId }), null, 2),
  );
}

async function cmdDoctor(args) {
  const projectRoot = resolve(String(args.project ?? '.'));
  const name = String(args.name ?? '');
  const base = await loadSubagentDefinition(projectRoot, name);
  const versionState = await loadVersionState(projectRoot, name);
  const merged = mergeSubagentLayers({ base, versionState });
  console.log(
    JSON.stringify(
      {
        ok: true,
        projectRoot,
        subagentName: name,
        activeVersion: merged.version,
        definitionDigest: merged.definitionDigest,
        appliedPatches: merged.appliedPatches,
        description: merged.effective.description,
      },
      null,
      2,
    ),
  );
}

async function cmdHistory(args) {
  const projectRoot = resolve(String(args.project ?? '.'));
  const name = args.name && args.name !== true ? String(args.name) : undefined;
  const limit = args.limit && args.limit !== true ? Number(args.limit) : 20;
  const report = await listRunHistory({
    projectRoot,
    subagentName: name,
    limit,
  });
  console.log(JSON.stringify(report, null, 2));
}

async function cmdCorrect(args) {
  const projectRoot = resolve(String(args.project ?? '.'));
  const name = String(args.name ?? '');
  const correction = String(args.correction ?? '');
  const afterBody = String(args['after-body'] ?? args.afterBody ?? '');
  const fromRun =
    args['from-run'] && args['from-run'] !== true
      ? String(args['from-run'])
      : args.fromRun && args.fromRun !== true
        ? String(args.fromRun)
        : undefined;
  const result = await correctFromRun({
    projectRoot,
    name,
    correction,
    afterBody,
    fromRun,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || /** @type {string[]} */ (args._).length === 0) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }
  const [cmd, sub] = /** @type {string[]} */ (args._);

  try {
    if (cmd === 'invoke' || cmd === 'run') await cmdInvoke(args);
    else if (cmd === 'list') await cmdList(args);
    else if (cmd === 'history') await cmdHistory(args);
    else if (cmd === 'show-run') await cmdShowRun(args);
    else if (cmd === 'versions') await cmdVersions(args);
    else if (cmd === 'diff') await cmdDiff(args);
    else if (cmd === 'correct') await cmdCorrect(args);
    else if (cmd === 'evolve') await cmdEvolve(args);
    else if (cmd === 'revert') await cmdRevert(args);
    else if (cmd === 'doctor') await cmdDoctor(args);
    else if (cmd === 'demo' && sub === 'correct-once') {
      const projectRoot = resolve(String(args.project ?? './fixtures/demo-correct-once/project'));
      const report = await runCorrectOnceDemo({ projectRoot });
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.pass ? 0 : 1);
    } else if (cmd === 'demo' && sub === 'b1') {
      const projectRoot = resolve(String(args.project ?? './fixtures/demo-correct-once/project'));
      const report = await runB1Demo({ projectRoot });
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.pass ? 0 : 1);
    } else if (cmd === 'init') {
      const result = await initProject({
        projectRoot: resolve(String(args.project ?? '.')),
        template: args.template,
      });
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHelp();
      process.exit(1);
    }
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: String(/** @type {Error} */ (error).message ?? error) }, null, 2));
    process.exit(1);
  }
}

main();
