import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEvolutionPatch, loadVersionState } from '../src/evolve/apply.mjs';
import { createAcceptedPatch } from '../src/evolve/patch.mjs';
import { loadSubagentDefinition } from '../src/define/load.mjs';
import { mergeSubagentLayers } from '../src/layers/merge.mjs';
import { materializeSubagentContext } from '../src/spawn/materialize.mjs';
import { writeRunRecord } from '../src/ledger/run.mjs';
import { resolveProjectPaths } from '../src/ledger/paths.mjs';

const FIXTURE = resolve(fileURLToPath(new URL('../fixtures/demo-correct-once/project', import.meta.url)));

describe('schemaVersion freeze', () => {
  /** @type {string} */
  let workRoot;

  before(async () => {
    workRoot = join(FIXTURE, '..', `.test-schema-${Date.now()}`);
    await mkdir(workRoot, { recursive: true });
    await cp(FIXTURE, workRoot, { recursive: true });
  });

  after(async () => {
    await rm(workRoot, { recursive: true, force: true });
  });

  it('writes schemaVersion:1 on version, patch, run, materialize', async () => {
    const name = 'echo-policy';
    const base = await loadSubagentDefinition(workRoot, name);
    const before = await loadVersionState(workRoot, name);
    const merged = mergeSubagentLayers({ base, versionState: before });
    const patch = createAcceptedPatch({
      subagentName: name,
      correction: 'schema stamp',
      beforeText: merged.effective.body,
      afterText: 'body with NEW: schema version stamp',
      patchId: `patch-schema-${Date.now().toString(36)}`,
    });
    const applied = await applyEvolutionPatch({ projectRoot: workRoot, patch });

    const versionDisk = JSON.parse(await readFile(applied.versionRef, 'utf8'));
    assert.equal(versionDisk.schemaVersion, 1);

    const patchDisk = JSON.parse(await readFile(applied.patchRef, 'utf8'));
    assert.equal(patchDisk.schemaVersion, 1);

    const mat = await materializeSubagentContext({
      projectRoot: workRoot,
      subagentName: name,
      task: 'schema check',
    });
    const matDisk = JSON.parse(await readFile(mat.materializedContextRef, 'utf8'));
    assert.equal(matDisk.schemaVersion, 1);

    const { runRef, record } = await writeRunRecord({
      projectRoot: workRoot,
      subagentName: name,
      task: 'schema check',
      activeVersion: mat.activeVersion,
      definitionDigest: mat.definitionDigest,
      materializedContextRef: mat.materializedContextRef,
    });
    assert.equal(record.schemaVersion, 1);
    const runDisk = JSON.parse(await readFile(runRef, 'utf8'));
    assert.equal(runDisk.schemaVersion, 1);

    // load default missing-file path also reports schemaVersion for new states
    const fresh = await loadVersionState(workRoot, 'never-defined-name');
    assert.equal(fresh.schemaVersion, 1);
  });
});
