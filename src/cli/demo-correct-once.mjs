import { cp, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invokeSubagent } from '../spawn/invoke.mjs';
import { applyEvolutionPatch } from '../evolve/apply.mjs';
import { createAcceptedPatch } from '../evolve/patch.mjs';
import { loadSubagentDefinition } from '../define/load.mjs';
import { loadVersionState } from '../evolve/apply.mjs';
import { mergeSubagentLayers } from '../layers/merge.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DEFAULT_FIXTURE = resolve(HERE, '../../fixtures/demo-correct-once/project');

/**
 * Hermetic PASS demo: OLD: → correct → NEW: materialize.
 * @param {{ projectRoot?: string, workRoot?: string }} options
 */
export async function runCorrectOnceDemo(options = {}) {
  const fixtureProject = resolve(options.projectRoot ?? DEFAULT_FIXTURE);
  // Copy fixture to temp work dir under project so we don't dirty the fixture's .evosubagent
  const workRoot =
    options.workRoot ??
    join(fixtureProject, '..', `.work-${Date.now().toString(36)}`);
  await rm(workRoot, { recursive: true, force: true });
  await mkdir(workRoot, { recursive: true });
  await cp(fixtureProject, workRoot, { recursive: true });

  const subagentName = 'echo-policy';
  const task = 'answer with the required prefix';

  const first = await invokeSubagent({
    projectRoot: workRoot,
    subagentName,
    task,
  });

  const base = await loadSubagentDefinition(workRoot, subagentName);
  const versionBefore = await loadVersionState(workRoot, subagentName);
  const mergedBefore = mergeSubagentLayers({ base, versionState: versionBefore });

  const correction =
    'Always answer with prefix NEW: instead of OLD:. Never use OLD: again.';
  const afterBody = [
    '# Echo Policy',
    '',
    'When answering any task, start the first line with exactly `NEW:`.',
    'Do not use the prefix `OLD:` under any circumstance.',
    'Then restate the task briefly.',
  ].join('\n');

  const patch = createAcceptedPatch({
    subagentName,
    targetKind: 'subagent-body',
    correction,
    beforeText: mergedBefore.effective.body,
    afterText: afterBody,
    sourceRefs: [first.runRef, 'demo:correct-once'],
  });

  const applied = await applyEvolutionPatch({
    projectRoot: workRoot,
    patch,
    actorRef: 'demo-correct-once',
  });

  const second = await invokeSubagent({
    projectRoot: workRoot,
    subagentName,
    task,
  });

  const checks = {
    firstRunExists: Boolean(first.record?.runId),
    firstVersion: first.record.activeVersion,
    patchApplied: applied.nextVersionState.version !== applied.previousVersionState.version,
    secondVersion: second.record.activeVersion,
    versionsDiffer: first.record.activeVersion !== second.record.activeVersion,
    digestsDiffer: first.record.definitionDigest !== second.record.definitionDigest,
    secondBodyHasNew: String(second.materialized.context.effective.body).includes('NEW:'),
    secondBodyLacksOldRequirement: !String(second.materialized.context.effective.body).includes(
      'start the first line with exactly `OLD:`',
    ),
    secondMaterializeVersionMatches: second.materialized.activeVersion === second.record.activeVersion,
  };

  const pass = Object.values(checks).every(Boolean);

  return {
    pass,
    workRoot,
    checks,
    firstRunRef: first.runRef,
    secondRunRef: second.runRef,
    patchRef: applied.patchRef,
    previousVersion: applied.previousVersionState.version,
    nextVersion: applied.nextVersionState.version,
  };
}
