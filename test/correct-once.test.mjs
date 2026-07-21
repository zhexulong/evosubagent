import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCorrectOnceDemo } from '../src/cli/demo-correct-once.mjs';

describe('PASS demo correct-once', () => {
  it('materializes correction on second invoke', async () => {
    const report = await runCorrectOnceDemo({});
    assert.equal(report.pass, true, JSON.stringify(report.checks, null, 2));
    assert.equal(report.previousVersion, '1');
    assert.equal(report.nextVersion, '2');
    assert.notEqual(report.checks.firstVersion, report.checks.secondVersion);
  });
});
