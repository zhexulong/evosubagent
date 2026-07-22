import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveProjectPaths } from '../ledger/paths.mjs';

/**
 * List run ledger records for a project (newest first).
 * @param {{
 *   projectRoot: string,
 *   subagentName?: string,
 *   limit?: number,
 * }} input
 */
export async function listRunHistory(input) {
  const paths = resolveProjectPaths(input.projectRoot);
  let names = [];
  try {
    names = await readdir(paths.runsPath);
  } catch {
    return { ok: true, projectRoot: input.projectRoot, runs: [], n: 0 };
  }

  /** @type {Array<Record<string, unknown> & { runRef: string }>} */
  const runs = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const runRef = join(paths.runsPath, name);
    try {
      const record = JSON.parse(await readFile(runRef, 'utf8'));
      if (input.subagentName && record.subagentName !== input.subagentName) continue;
      runs.push({ ...record, runRef });
    } catch {
      /* skip corrupt */
    }
  }

  runs.sort((a, b) => {
    const ta = typeof a.createdAt === 'string' ? a.createdAt : '';
    const tb = typeof b.createdAt === 'string' ? b.createdAt : '';
    return tb.localeCompare(ta);
  });

  const limit = Math.max(1, Number(input.limit ?? 20) || 20);
  const sliced = runs.slice(0, limit);
  return {
    ok: true,
    projectRoot: input.projectRoot,
    n: sliced.length,
    nTotal: runs.length,
    runs: sliced.map((r) => ({
      runId: r.runId,
      subagentName: r.subagentName,
      activeVersion: r.activeVersion,
      status: r.status,
      runtime: r.runtime,
      createdAt: r.createdAt,
      task: typeof r.task === 'string' ? r.task.slice(0, 160) : r.task,
      resultSummary:
        typeof r.resultSummary === 'string' ? r.resultSummary.slice(0, 200) : r.resultSummary,
      definitionDigest:
        typeof r.definitionDigest === 'string'
          ? r.definitionDigest.slice(0, 16)
          : r.definitionDigest,
      runRef: r.runRef,
    })),
  };
}
