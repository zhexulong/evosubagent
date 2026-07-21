#!/usr/bin/env node
/**
 * Summarize one or more eval result JSON files (A0/B0 arm reports).
 * Usage: node eval/runners/summarize.mjs [paths...]
 * If no paths given, prints empty summary schema.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * @param {unknown} report
 */
function normalizeReport(report) {
  if (!report || typeof report !== 'object') return null;
  const r = /** @type {Record<string, unknown>} */ (report);
  const arms = r.arms && typeof r.arms === 'object' ? /** @type {Record<string, unknown>} */ (r.arms) : {};
  return {
    id: typeof r.id === 'string' ? r.id : 'unknown',
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : null,
    arms: Object.fromEntries(
      Object.entries(arms).map(([arm, value]) => {
        const v = value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};
        const tasks = Array.isArray(v.tasks) ? v.tasks : [];
        const passed = tasks.filter((t) => t && typeof t === 'object' && /** @type {{pass?: boolean}} */ (t).pass).length;
        return [
          arm,
          {
            taskCount: tasks.length,
            passCount: passed,
            passRate: tasks.length ? passed / tasks.length : 0,
            tasks,
          },
        ];
      }),
    ),
  };
}

async function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          note: 'No input files; pass one or more result JSON paths',
          reports: [],
          aggregate: {},
        },
        null,
        2,
      ),
    );
    return;
  }

  /** @type {ReturnType<typeof normalizeReport>[]} */
  const reports = [];
  for (const p of paths) {
    const raw = JSON.parse(await readFile(resolve(p), 'utf8'));
    reports.push(normalizeReport(raw));
  }

  /** @type {Record<string, { taskCount: number, passCount: number }>} */
  const aggregate = {};
  for (const report of reports) {
    if (!report) continue;
    for (const [arm, stats] of Object.entries(report.arms)) {
      const bucket = (aggregate[arm] ??= { taskCount: 0, passCount: 0 });
      bucket.taskCount += stats.taskCount;
      bucket.passCount += stats.passCount;
    }
  }

  const summary = Object.fromEntries(
    Object.entries(aggregate).map(([arm, s]) => [
      arm,
      {
        ...s,
        passRate: s.taskCount ? s.passCount / s.taskCount : 0,
      },
    ]),
  );

  console.log(JSON.stringify({ ok: true, reports, aggregate: summary }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error?.message ?? error) }, null, 2));
  process.exit(1);
});
