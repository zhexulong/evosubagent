import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireString } from '../define/schema.mjs';
import { resolveProjectPaths } from './paths.mjs';

/**
 * @param {{
 *   projectRoot: string,
 *   subagentName: string,
 *   task: string,
 *   activeVersion: string,
 *   definitionDigest: string,
 *   materializedContextRef?: string,
 *   resultSummary?: string,
 *   runId?: string,
 *   runtime?: string,
 *   status?: 'ok' | 'error',
 * }} input
 */
export async function writeRunRecord(input) {
  const paths = resolveProjectPaths(input.projectRoot);
  const runId = input.runId ?? randomUUID();
  const subagentName = requireString(input.subagentName, 'subagentName');
  const task = requireString(input.task, 'task');
  const activeVersion = requireString(input.activeVersion, 'activeVersion');
  const definitionDigest = requireString(input.definitionDigest, 'definitionDigest');
  const status = input.status === 'error' ? 'error' : 'ok';

  const record = {
    schemaVersion: 1,
    runId,
    subagentName,
    task,
    activeVersion,
    definitionDigest,
    materializedContextRef: input.materializedContextRef ?? null,
    resultSummary: input.resultSummary ?? null,
    status,
    createdAt: new Date().toISOString(),
    runtime: typeof input.runtime === 'string' && input.runtime.trim()
      ? input.runtime.trim()
      : 'pi-first-stub',
  };

  await mkdir(paths.runsPath, { recursive: true });
  const runRef = join(paths.runsPath, `${runId}.json`);
  await writeFile(runRef, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return { runRef, record };
}

/**
 * @param {string} projectRoot
 * @param {string} runId
 */
export async function readRunRecord(projectRoot, runId) {
  const paths = resolveProjectPaths(projectRoot);
  const runRef = join(paths.runsPath, `${requireString(runId, 'runId')}.json`);
  return {
    runRef,
    record: JSON.parse(await readFile(runRef, 'utf8')),
  };
}
