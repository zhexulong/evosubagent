import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initProject } from '../src/cli/init.mjs';
import { materializeSubagentContext } from '../src/spawn/materialize.mjs';
import { buildPiChildPrompt } from '../src/spawn/pi-child.mjs';
import { loadSubagentDefinition } from '../src/define/load.mjs';

describe('cold-presets init + materialize', () => {
  /** @type {string} */
  let projectRoot;

  before(async () => {
    projectRoot = join(tmpdir(), `evo-cold-${Date.now()}`);
    await mkdir(projectRoot, { recursive: true });
  });

  after(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('init --template cold-presets installs worker/explore/reviewer', async () => {
    const result = await initProject({ projectRoot, template: 'cold-presets' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.templates?.sort(), ['explore', 'reviewer', 'worker']);
    for (const name of ['worker', 'explore', 'reviewer']) {
      await access(join(projectRoot, '.evosubagent/subagents', name, 'SUBAGENT.md'));
      const def = await loadSubagentDefinition(projectRoot, name);
      assert.equal(def.name, name);
      assert.match(def.description, /^(Use when|Activate when)/i);
    }
  });

  it('materialize worker yields pin-safe prompt with body+task', async () => {
    const mat = await materializeSubagentContext({
      projectRoot,
      subagentName: 'worker',
      task: 'fix the broken build',
    });
    assert.equal(mat.activeVersion, '1');
    assert.ok(mat.definitionDigest.startsWith('sha256:'));
    assert.ok(mat.context.effective.body.length > 0);
    assert.deepEqual(mat.context.appliedPatches ?? [], []);

    const prompt = buildPiChildPrompt({
      subagentName: 'worker',
      activeVersion: mat.activeVersion,
      definitionDigest: mat.definitionDigest,
      body: mat.context.effective.body,
      task: 'fix the broken build',
    });
    assert.match(prompt, /You are subagent worker version 1/);
    assert.match(prompt, /definitionDigest: sha256:/);
    assert.match(prompt, /Task:\nfix the broken build/);
    assert.match(prompt, /coding worker/i);
  });
});
