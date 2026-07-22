import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initProject } from '../src/cli/init.mjs';
import { invokeSubagent } from '../src/spawn/invoke.mjs';
import { listRunHistory } from '../src/cli/history.mjs';
import { correctFromRun } from '../src/cli/correct.mjs';
import { materializeSubagentContext } from '../src/spawn/materialize.mjs';

describe('history + correct UX', () => {
  it('lists runs after invoke and correct links from-run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hist-correct-'));
    try {
      await initProject({ projectRoot: root, template: 'echo-policy' });
      const first = await invokeSubagent({
        projectRoot: root,
        subagentName: 'echo-policy',
        task: 'say hello',
      });
      assert.equal(first.ok, true);
      assert.ok(first.record.runId);

      const hist = await listRunHistory({ projectRoot: root, limit: 5 });
      assert.equal(hist.ok, true);
      assert.ok(hist.nTotal >= 1);
      assert.equal(hist.runs[0].runId, first.record.runId);

      const afterBody = [
        '# Echo Policy',
        '',
        'When answering any task, start the first line with exactly `NEW:`.',
        'Then restate the task briefly.',
      ].join('\n');

      const corr = await correctFromRun({
        projectRoot: root,
        name: 'echo-policy',
        correction: 'Use NEW: prefix',
        afterBody,
        fromRun: first.record.runId,
      });
      assert.equal(corr.ok, true);
      assert.notEqual(corr.previousVersion, corr.nextVersion);
      assert.ok(corr.sourceRefs.includes(first.record.runId));
      assert.equal(corr.fromRun?.runId, first.record.runId);

      const mat = await materializeSubagentContext({
        projectRoot: root,
        subagentName: 'echo-policy',
        task: 'x',
      });
      assert.equal(mat.activeVersion, corr.nextVersion);
      assert.match(mat.context.effective.body, /NEW:/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
