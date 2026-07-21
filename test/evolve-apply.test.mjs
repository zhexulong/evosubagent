import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEvolutionPatch, loadVersionState } from '../src/evolve/apply.mjs';
import { createAcceptedPatch } from '../src/evolve/patch.mjs';
import { loadSubagentDefinition } from '../src/define/load.mjs';
import { mergeSubagentLayers } from '../src/layers/merge.mjs';

const FIXTURE = resolve(fileURLToPath(new URL('../fixtures/demo-correct-once/project', import.meta.url)));

describe('evolve apply', () => {
  /** @type {string} */
  let workRoot;

  before(async () => {
    workRoot = join(FIXTURE, '..', `.test-apply-${Date.now()}`);
    await mkdir(workRoot, { recursive: true });
    await cp(FIXTURE, workRoot, { recursive: true });
  });

  after(async () => {
    await rm(workRoot, { recursive: true, force: true });
  });

  it('bumps version and stores body', async () => {
    const name = 'echo-policy';
    const base = await loadSubagentDefinition(workRoot, name);
    const before = await loadVersionState(workRoot, name);
    const merged = mergeSubagentLayers({ base, versionState: before });
    const patch = createAcceptedPatch({
      subagentName: name,
      correction: 'use NEW',
      beforeText: merged.effective.body,
      afterText: 'body with NEW: prefix rule',
    });
    const result = await applyEvolutionPatch({ projectRoot: workRoot, patch });
    assert.equal(result.previousVersionState.version, '1');
    assert.equal(result.nextVersionState.version, '2');
    assert.equal(result.nextVersionState.body, 'body with NEW: prefix rule');
    const loaded = await loadVersionState(workRoot, name);
    assert.equal(loaded.version, '2');
  });
});
