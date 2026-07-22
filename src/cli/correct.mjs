import { readRunRecord } from '../ledger/run.mjs';
import { loadSubagentDefinition } from '../define/load.mjs';
import { loadVersionState, applyEvolutionPatch } from '../evolve/apply.mjs';
import { mergeSubagentLayers } from '../layers/merge.mjs';
import { createAcceptedPatch } from '../evolve/patch.mjs';

/**
 * Apply a body correction linked to a run (correct UX over evolve).
 *
 * @param {{
 *   projectRoot: string,
 *   name: string,
 *   correction: string,
 *   afterBody: string,
 *   fromRun?: string,
 *   actorRef?: string,
 * }} input
 */
export async function correctFromRun(input) {
  const name = input.name;
  const correction = input.correction;
  const afterBody = input.afterBody;
  if (!name || !correction || !afterBody) {
    throw new Error('correct requires --name, --correction, --after-body');
  }

  const base = await loadSubagentDefinition(input.projectRoot, name);
  const versionState = await loadVersionState(input.projectRoot, name);
  const merged = mergeSubagentLayers({ base, versionState });

  /** @type {string[]} */
  const sourceRefs = ['cli:correct'];
  /** @type {Record<string, unknown>|null} */
  let linkedRun = null;

  if (input.fromRun) {
    const { record, runRef } = await readRunRecord(input.projectRoot, input.fromRun);
    if (record.subagentName && record.subagentName !== name) {
      throw new Error(
        `run ${input.fromRun} belongs to subagent ${record.subagentName}, not ${name}`,
      );
    }
    linkedRun = { ...record, runRef };
    sourceRefs.push(input.fromRun);
    sourceRefs.push(runRef);
    if (record.definitionDigest) sourceRefs.push(`digest:${record.definitionDigest}`);
    if (record.task) sourceRefs.push(`task:${String(record.task).slice(0, 120)}`);
    if (record.activeVersion) sourceRefs.push(`version:${record.activeVersion}`);
  }

  const patch = createAcceptedPatch({
    subagentName: name,
    targetKind: 'subagent-body',
    correction,
    beforeText: merged.effective.body,
    afterText: afterBody,
    sourceRefs,
  });

  const applied = await applyEvolutionPatch({
    projectRoot: input.projectRoot,
    patch,
    actorRef: input.actorRef ?? 'cli:correct',
  });

  return {
    ok: true,
    patchRef: applied.patchRef,
    versionRef: applied.versionRef,
    previousVersion: applied.previousVersionState.version,
    nextVersion: applied.nextVersionState.version,
    sourceRefs: applied.appliedPatch.sourceRefs,
    fromRun: linkedRun
      ? {
          runId: linkedRun.runId,
          activeVersion: linkedRun.activeVersion,
          status: linkedRun.status,
          task:
            typeof linkedRun.task === 'string'
              ? linkedRun.task.slice(0, 160)
              : linkedRun.task,
        }
      : null,
  };
}
