import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initProject } from '../src/cli/init.mjs';
import { resolveProjectPaths } from '../src/ledger/paths.mjs';
import { loadSubagentDefinition } from '../src/define/load.mjs';
import { loadVersionState } from '../src/evolve/apply.mjs';
import { mergeSubagentLayers } from '../src/layers/merge.mjs';

describe('init bootstrap', () => {
  /** @type {string} */
  let projectRoot;

  before(async () => {
    projectRoot = join(tmpdir(), `evosubagent-init-${Date.now()}`);
    await mkdir(projectRoot, { recursive: true });
  });

  after(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('creates full .evosubagent tree', async () => {
    const result = await initProject({ projectRoot });
    assert.equal(result.ok, true);
    const paths = resolveProjectPaths(projectRoot);
    for (const p of [
      paths.stateRoot,
      paths.subagentsPath,
      paths.versionsPath,
      paths.patchesPath,
      paths.runsPath,
      paths.materializePath,
    ]) {
      await access(p);
    }
  });

  it('scaffolds echo-policy template and doctor can load it', async () => {
    const result = await initProject({
      projectRoot,
      template: 'echo-policy',
    });
    assert.equal(result.ok, true);
    assert.equal(result.template, 'echo-policy');
    assert.ok(result.subagentPath);
    const md = await readFile(result.subagentPath, 'utf8');
    assert.match(md, /name:\s*echo-policy/);
    assert.match(md, /Use when/i);

    const base = await loadSubagentDefinition(projectRoot, 'echo-policy');
    const versionState = await loadVersionState(projectRoot, 'echo-policy');
    const merged = mergeSubagentLayers({ base, versionState });
    assert.equal(merged.version, '1');
    assert.equal(base.name, 'echo-policy');
    assert.ok(merged.definitionDigest.startsWith('sha256:'));
  });

  it('scaffolds worker template', async () => {
    const root = join(tmpdir(), `evosubagent-init-worker-${Date.now()}`);
    await mkdir(root, { recursive: true });
    try {
      const result = await initProject({ projectRoot: root, template: 'worker' });
      assert.equal(result.template, 'worker');
      const base = await loadSubagentDefinition(root, 'worker');
      assert.equal(base.name, 'worker');
      assert.match(base.description, /^Use when/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
