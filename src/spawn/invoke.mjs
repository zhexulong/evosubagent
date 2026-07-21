import { materializeSubagentContext } from './materialize.mjs';
import { writeRunRecord } from '../ledger/run.mjs';
import { requireString } from '../define/schema.mjs';
import { buildPiChildPrompt, spawnPiChild } from './pi-child.mjs';

/**
 * Stage-1 invoke: hermetic host materialize + deterministic "result"
 * or optional live Pi child (`runtime: 'pi-child'`).
 *
 * Always writes a RunRecord. `ok` / `record.status` reflect execution outcome.
 *
 * @param {{
 *   projectRoot: string,
 *   subagentName: string,
 *   task: string,
 *   pinVersion?: string,
 *   runtime?: 'pi-first-stub' | 'pi-child',
 *   forceLive?: boolean,
 * }} input
 */
export async function invokeSubagent(input) {
  const projectRoot = requireString(input.projectRoot, 'projectRoot');
  const subagentName = requireString(input.subagentName, 'subagentName');
  const task = requireString(input.task, 'task');
  const runtime =
    input.runtime ??
    (process.env.EVOSUBAGENT_RUNTIME === 'pi-child' ? 'pi-child' : 'pi-first-stub');

  const materialized = await materializeSubagentContext({
    projectRoot,
    subagentName,
    task,
    pinVersion: input.pinVersion,
  });

  const body = materialized.context.effective.body;
  /** @type {string} */
  let resultSummary;
  /** @type {string} */
  let runRuntime = 'pi-first-stub';
  /** @type {'ok' | 'error'} */
  let status = 'ok';

  if (runtime === 'pi-child') {
    const prompt = buildPiChildPrompt({
      subagentName,
      activeVersion: materialized.activeVersion,
      definitionDigest: materialized.definitionDigest,
      body,
      task,
    });
    const child = await spawnPiChild({
      prompt,
      projectRoot,
      force: input.forceLive === true,
    });
    runRuntime = child.runtime;
    if (child.ok) {
      resultSummary = child.stdout.trim().slice(0, 4000) || '(empty pi stdout)';
      status = 'ok';
    } else {
      status = 'error';
      resultSummary = [
        `subagent=${subagentName}`,
        `version=${materialized.activeVersion}`,
        `task=${task}`,
        '--- pi-child error ---',
        child.error ?? 'unknown',
        child.stderr.slice(0, 1000),
        child.stdout.slice(0, 500),
      ]
        .filter(Boolean)
        .join('\n');
    }
  } else {
    resultSummary = [
      `subagent=${subagentName}`,
      `version=${materialized.activeVersion}`,
      `task=${task}`,
      '--- guidance ---',
      body.slice(0, 500),
    ].join('\n');
  }

  const { runRef, record } = await writeRunRecord({
    projectRoot,
    subagentName,
    task,
    activeVersion: materialized.activeVersion,
    definitionDigest: materialized.definitionDigest,
    materializedContextRef: materialized.materializedContextRef,
    resultSummary,
    runtime: runRuntime,
    status,
  });

  return {
    ok: status === 'ok',
    runRef,
    record,
    materialized,
    resultSummary,
  };
}
