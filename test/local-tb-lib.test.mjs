import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDelta, loadSubsetConfig, DEFAULT_CONFIG } from '../eval/runners/lib/local-tb.mjs';

describe('local-tb helpers', () => {
  it('summarizeDelta computes pass rates and ΔResolve', () => {
    const s = summarizeDelta([
      { arm: 'A0', taskId: 't1', reward: 1, pass: true },
      { arm: 'A0', taskId: 't2', reward: 0, pass: false },
      { arm: 'B0_cold', taskId: 't1', reward: 1, pass: true },
      { arm: 'B0_cold', taskId: 't2', reward: 1, pass: true },
    ]);
    assert.equal(s.arms.A0.passRate, 0.5);
    assert.equal(s.arms.B0_cold.passRate, 1);
    assert.equal(s.deltaResolve, 0.5);
  });

  it('loadSubsetConfig validates frozen hash', async () => {
    const c = await loadSubsetConfig(DEFAULT_CONFIG);
    assert.equal(c.taskCount, 16);
    assert.equal(c.model.ref, 'cpa-oai/grok-4.5');
    assert.ok(c.taskListHash);
  });
});
