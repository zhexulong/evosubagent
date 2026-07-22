import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, cp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initProject } from '../src/cli/init.mjs';
import { invokeSubagent } from '../src/spawn/invoke.mjs';
import { applyEvolutionPatch, loadVersionState } from '../src/evolve/apply.mjs';
import { createAcceptedPatch } from '../src/evolve/patch.mjs';
import { loadSubagentDefinition } from '../src/define/load.mjs';
import { mergeSubagentLayers } from '../src/layers/merge.mjs';
import {
  listSubagents,
  showRun,
  listVersionHistory,
  diffSubagent,
  unifiedDiff,
} from '../src/cli/inspect.mjs';
import { revertToVersion } from '../src/evolve/revert-to.mjs';
import { materializeSubagentContext } from '../src/spawn/materialize.mjs';

const FIXTURE = resolve(
  fileURLToPath(new URL('../fixtures/demo-correct-once/project', import.meta.url)),
);

describe('inspect CLI helpers', () => {
  /** @type {string} */
  let workRoot;

  before(async () => {
    workRoot = join(FIXTURE, '..', `.test-inspect-${Date.now()}`);
    await mkdir(workRoot, { recursive: true });
    await cp(FIXTURE, workRoot, { recursive: true });
  });

  after(async () => {
    await rm(workRoot, { recursive: true, force: true });
  });

  it('lists subagents and show-run', async () => {
    const listed = await listSubagents({ projectRoot: workRoot });
    assert.equal(listed.ok, true);
    assert.ok(listed.agents.some((a) => a.name === 'echo-policy'));

    const inv = await invokeSubagent({
      projectRoot: workRoot,
      subagentName: 'echo-policy',
      task: 'inspect me',
      runtime: 'pi-first-stub',
    });
    assert.equal(inv.ok, true);
    const shown = await showRun({
      projectRoot: workRoot,
      runId: String(inv.record.runId),
    });
    assert.equal(shown.ok, true);
    assert.equal(shown.record.task, 'inspect me');
    assert.ok(shown.privacyNote);
  });

  it('diffs last patch and reverts to version 1', async () => {
    const name = 'echo-policy';
    const base = await loadSubagentDefinition(workRoot, name);
    const before = await loadVersionState(workRoot, name);
    const merged = mergeSubagentLayers({ base, versionState: before });
    const patch = createAcceptedPatch({
      subagentName: name,
      correction: 'add NEW for diff test',
      beforeText: merged.effective.body,
      afterText: 'body with NEW: for inspect diff',
      patchId: `patch-inspect-${Date.now().toString(36)}`,
    });
    const applied = await applyEvolutionPatch({ projectRoot: workRoot, patch });
    assert.equal(applied.nextVersionState.version, '2');

    const history = await listVersionHistory({ projectRoot: workRoot, name });
    assert.ok(history.patches.length >= 1);

    const d = await diffSubagent({
      projectRoot: workRoot,
      name,
      patchId: applied.appliedPatch.patchId,
    });
    assert.equal(d.mode, 'patch');
    assert.match(String(d.unified), /\+.*NEW:/);

    const rev = await revertToVersion({
      projectRoot: workRoot,
      subagentName: name,
      toVersion: '1',
    });
    assert.equal(rev.ok, true);
    assert.equal(rev.activeVersion, '1');

    const mat = await materializeSubagentContext({
      projectRoot: workRoot,
      subagentName: name,
      task: 'after revert-to',
    });
    assert.equal(mat.activeVersion, '1');
  });

  it('unifiedDiff marks changed lines', () => {
    const u = unifiedDiff('a\nb\n', 'a\nc\n');
    assert.match(u, /^-b$/m);
    assert.match(u, /^\+c$/m);
  });
});
