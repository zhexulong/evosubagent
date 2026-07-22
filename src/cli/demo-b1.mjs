import { cp, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invokeSubagent } from '../spawn/invoke.mjs';
import { listRunHistory } from './history.mjs';
import { correctFromRun } from './correct.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DEFAULT_FIXTURE = resolve(HERE, '../../fixtures/demo-correct-once/project');

/**
 * B1 hermetic demo: product path invoke → history → correct(--from-run) → invoke.
 * Deterministic stub runtime (no live LLM).
 *
 * @param {{ projectRoot?: string, workRoot?: string }} options
 */
export async function runB1Demo(options = {}) {
  const fixtureProject = resolve(options.projectRoot ?? DEFAULT_FIXTURE);
  const workRoot =
    options.workRoot ?? join(fixtureProject, '..', `.work-b1-${Date.now().toString(36)}`);
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

  const histAfterFirst = await listRunHistory({
    projectRoot: workRoot,
    subagentName,
    limit: 5,
  });
  const listed = histAfterFirst.runs.find((r) => r.runId === first.record.runId);

  const afterBody = [
    '# Echo Policy',
    '',
    'When answering any task, start the first line with exactly `NEW:`.',
    'Do not use the prefix `OLD:` under any circumstance.',
    'Then restate the task briefly.',
  ].join('\n');

  const corrected = await correctFromRun({
    projectRoot: workRoot,
    name: subagentName,
    correction: 'Always answer with prefix NEW: instead of OLD:. Never use OLD: again.',
    afterBody,
    fromRun: first.record.runId,
    actorRef: 'demo-b1',
  });

  const second = await invokeSubagent({
    projectRoot: workRoot,
    subagentName,
    task,
  });

  const histAfterSecond = await listRunHistory({
    projectRoot: workRoot,
    subagentName,
    limit: 10,
  });

  const checks = {
    firstRunOk: Boolean(first.ok && first.record?.runId),
    firstVersion: first.record.activeVersion,
    historyListsFirstRun: Boolean(listed),
    historyNewestIsFirstAfterInvoke: histAfterFirst.runs[0]?.runId === first.record.runId,
    correctOk: corrected.ok === true,
    correctFromRunId: corrected.fromRun?.runId === first.record.runId,
    sourceRefsIncludeRunId: Array.isArray(corrected.sourceRefs)
      ? corrected.sourceRefs.includes(first.record.runId)
      : false,
    versionAdvanced: corrected.previousVersion !== corrected.nextVersion,
    secondRunOk: Boolean(second.ok && second.record?.runId),
    versionsDiffer: first.record.activeVersion !== second.record.activeVersion,
    digestsDiffer: first.record.definitionDigest !== second.record.definitionDigest,
    secondVersionMatchesCorrect: second.record.activeVersion === corrected.nextVersion,
    secondBodyHasNew: String(second.materialized.context.effective.body).includes('NEW:'),
    secondBodyLacksOldRequirement: !String(second.materialized.context.effective.body).includes(
      'start the first line with exactly `OLD:`',
    ),
    secondMaterializeVersionMatches:
      second.materialized.activeVersion === second.record.activeVersion,
    historyHasTwoRuns: histAfterSecond.nTotal >= 2,
  };

  const pass = Object.values(checks).every((v) => v === true || typeof v === 'string');

  return {
    protocol: 'B1',
    pass,
    workRoot,
    checks,
    firstRunId: first.record.runId,
    secondRunId: second.record.runId,
    previousVersion: corrected.previousVersion,
    nextVersion: corrected.nextVersion,
    patchRef: corrected.patchRef,
    sourceRefs: corrected.sourceRefs,
    historyAfterFirst: histAfterFirst.runs.map((r) => r.runId),
    historyAfterSecond: histAfterSecond.runs.map((r) => r.runId),
    successCriteria:
      'version/digest change + next materialize includes after-body (not TB Δ)',
  };
}
