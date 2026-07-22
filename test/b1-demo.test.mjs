import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runB1Demo } from '../src/cli/demo-b1.mjs';
import { rm } from 'node:fs/promises';

describe('B1 protocol demo', () => {
  it('invoke → history → correct(--from-run) → invoke materialize', async () => {
    const report = await runB1Demo({});
    try {
      assert.equal(report.pass, true, JSON.stringify(report.checks, null, 2));
      assert.equal(report.protocol, 'B1');
      assert.ok(report.firstRunId);
      assert.ok(report.secondRunId);
      assert.notEqual(report.previousVersion, report.nextVersion);
      assert.ok(report.sourceRefs.includes(report.firstRunId));
      assert.equal(report.checks.historyListsFirstRun, true);
      assert.equal(report.checks.secondBodyHasNew, true);
    } finally {
      if (report.workRoot) await rm(report.workRoot, { recursive: true, force: true });
    }
  });
});
