#!/usr/bin/env node
/**
 * Summarize L2a tb-subset report(s) into a short table.
 * Usage: node eval/runners/summarize-tb.mjs eval/out/tb-subset-*.json
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.log(JSON.stringify({ ok: true, note: 'pass one or more tb-subset report paths', reports: [] }, null, 2));
    return;
  }
  const reports = [];
  for (const p of paths) {
    const r = JSON.parse(await readFile(resolve(p), 'utf8'));
    const arms = r.arms || {};
    const row = {
      id: r.id,
      modelRef: r.modelRef,
      taskCount: Array.isArray(r.taskIds) ? r.taskIds.length : null,
      taskListHash: r.taskListHash,
      A0: arms.A0?.stats ?? null,
      B0_cold: arms.B0_cold?.stats ?? null,
      deltaResolve: r.deltaResolve,
    };
    reports.push(row);
  }
  console.log(JSON.stringify({ ok: true, reports }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
  process.exit(1);
});
