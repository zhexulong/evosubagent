import { materializeSubagentContext } from './materialize.mjs';
import { writeRunRecord } from '../ledger/run.mjs';
import { requireString } from '../define/schema.mjs';

/**
 * Stage-1 invoke: hermetic host materialize + deterministic "result"
 * (no live LLM). Live Pi adapter later; contract stays the same.
 *
 * @param {{
 *   projectRoot: string,
 *   subagentName: string,
 *   task: string,
 *   pinVersion?: string,
 * }} input
 */
export async function invokeSubagent(input) {
  const projectRoot = requireString(input.projectRoot, 'projectRoot');
  const subagentName = requireString(input.subagentName, 'subagentName');
  const task = requireString(input.task, 'task');

  const materialized = await materializeSubagentContext({
    projectRoot,
    subagentName,
    task,
    pinVersion: input.pinVersion,
  });

  // Deterministic stub result: surface the body prefix instruction if present.
  const body = materialized.context.effective.body;
  const resultSummary = [
    `subagent=${subagentName}`,
    `version=${materialized.activeVersion}`,
    `task=${task}`,
    '--- guidance ---',
    body.slice(0, 500),
  ].join('\n');

  const { runRef, record } = await writeRunRecord({
    projectRoot,
    subagentName,
    task,
    activeVersion: materialized.activeVersion,
    definitionDigest: materialized.definitionDigest,
    materializedContextRef: materialized.materializedContextRef,
    resultSummary,
  });

  return {
    runRef,
    record,
    materialized,
    resultSummary,
  };
}
