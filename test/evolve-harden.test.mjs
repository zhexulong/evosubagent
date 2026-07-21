import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEvolutionPatch, loadVersionState, saveVersionState } from '../src/evolve/apply.mjs';
import { createAcceptedPatch } from '../src/evolve/patch.mjs';
import { revertEvolutionPatch } from '../src/evolve/revert.mjs';
import { loadSubagentDefinition } from '../src/define/load.mjs';
import { mergeSubagentLayers } from '../src/layers/merge.mjs';
import { materializeSubagentContext } from '../src/spawn/materialize.mjs';
import { resolveProjectPaths } from '../src/ledger/paths.mjs';

const FIXTURE = resolve(fileURLToPath(new URL('../fixtures/demo-correct-once/project', import.meta.url)));

describe('evolve harden', () => {
  /** @type {string} */
  let workRoot;

  before(async () => {
    workRoot = join(FIXTURE, '..', `.test-harden-${Date.now()}`);
    await mkdir(workRoot, { recursive: true });
    await cp(FIXTURE, workRoot, { recursive: true });
  });

  after(async () => {
    await rm(workRoot, { recursive: true, force: true });
  });

  it('rejects empty correction without version bump', async () => {
    const name = 'echo-policy';
    const before = await loadVersionState(workRoot, name);
    await assert.rejects(
      async () =>
        applyEvolutionPatch({
          projectRoot: workRoot,
          patch: createAcceptedPatch({
            subagentName: name,
            correction: '   ',
            beforeText: 'x',
            afterText: 'body with NEW: rule',
          }),
        }),
      /empty correction|reject|required non-empty string: patch\.correction/i,
    );
    const after = await loadVersionState(workRoot, name);
    assert.equal(after.version, before.version);
  });

  it('rejects identical afterText without version bump', async () => {
    const name = 'echo-policy';
    const base = await loadSubagentDefinition(workRoot, name);
    const versionState = await loadVersionState(workRoot, name);
    const merged = mergeSubagentLayers({ base, versionState });
    const body = merged.effective.body;
    await assert.rejects(
      async () =>
        applyEvolutionPatch({
          projectRoot: workRoot,
          patch: createAcceptedPatch({
            subagentName: name,
            correction: 'noop',
            beforeText: body,
            afterText: body,
          }),
        }),
      /identical|no-op|reject|afterText/i,
    );
    const after = await loadVersionState(workRoot, name);
    assert.equal(after.version, versionState.version);
  });

  it('reverts applied patch and materialize restores prior content', async () => {
    const name = 'echo-policy';
    const base = await loadSubagentDefinition(workRoot, name);
    const beforeState = await loadVersionState(workRoot, name);
    const beforeMerged = mergeSubagentLayers({ base, versionState: beforeState });
    const beforeBody = beforeMerged.effective.body;
    const beforeVersion = beforeMerged.version;
    const beforeDigest = beforeMerged.definitionDigest;

    const patch = createAcceptedPatch({
      subagentName: name,
      correction: 'use NEW prefix',
      beforeText: beforeBody,
      afterText: 'body with NEW: temporary rule for revert test',
      patchId: `patch-revert-${Date.now().toString(36)}`,
    });
    const applied = await applyEvolutionPatch({ projectRoot: workRoot, patch });
    assert.equal(applied.nextVersionState.version, '2');
    assert.match(applied.nextVersionState.body, /NEW:/);

    const mid = await materializeSubagentContext({
      projectRoot: workRoot,
      subagentName: name,
      task: 'check mid',
    });
    assert.equal(mid.activeVersion, '2');
    assert.match(mid.context.effective.body, /NEW:/);

    const reverted = await revertEvolutionPatch({
      projectRoot: workRoot,
      subagentName: name,
      patchId: applied.appliedPatch.patchId,
    });
    assert.equal(reverted.restoredVersionState.version, beforeVersion);
    assert.equal(reverted.appliedPatch.status, 'reverted');

    const loaded = await loadVersionState(workRoot, name);
    assert.equal(loaded.version, beforeVersion);
    assert.deepEqual(loaded.appliedPatches ?? [], beforeState.appliedPatches ?? []);

    const afterMat = await materializeSubagentContext({
      projectRoot: workRoot,
      subagentName: name,
      task: 'check after revert',
    });
    assert.equal(afterMat.activeVersion, beforeVersion);
    assert.equal(afterMat.context.effective.body, beforeBody);
    assert.equal(afterMat.definitionDigest, beforeDigest);

    const paths = resolveProjectPaths(workRoot);
    const patchDisk = JSON.parse(
      await readFile(join(paths.patchesPath, `${applied.appliedPatch.patchId}.json`), 'utf8'),
    );
    assert.equal(patchDisk.status, 'reverted');
  });

  it('saveVersionState writes via atomic rename (final path exists)', async () => {
    const name = 'echo-policy';
    const state = {
      subagentName: name,
      version: '1',
      appliedPatches: [],
      body: 'atomic-write-marker body',
    };
    const path = await saveVersionState(workRoot, state);
    const raw = await readFile(path, 'utf8');
    assert.match(raw, /atomic-write-marker/);
    // restore fixture-like default for subsequent tests if any share root
    await saveVersionState(workRoot, {
      subagentName: name,
      version: '1',
      appliedPatches: [],
    });
  });
});
