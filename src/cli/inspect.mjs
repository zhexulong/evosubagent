import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSubagentDefinition } from '../define/load.mjs';
import { loadVersionState } from '../evolve/apply.mjs';
import { mergeSubagentLayers } from '../layers/merge.mjs';
import { resolveProjectPaths } from '../ledger/paths.mjs';
import { readRunRecord } from '../ledger/run.mjs';
import { requireString } from '../define/schema.mjs';

/**
 * List subagents under .evosubagent/subagents with active version.
 * @param {{ projectRoot: string }} input
 */
export async function listSubagents(input) {
  const paths = resolveProjectPaths(input.projectRoot);
  let names = [];
  try {
    const entries = await readdir(paths.subagentsPath, { withFileTypes: true });
    names = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    names = [];
  }

  /** @type {Array<Record<string, unknown>>} */
  const agents = [];
  for (const name of names) {
    try {
      const base = await loadSubagentDefinition(input.projectRoot, name);
      const versionState = await loadVersionState(input.projectRoot, name);
      const merged = mergeSubagentLayers({ base, versionState });
      agents.push({
        name,
        activeVersion: merged.version,
        definitionDigest: merged.definitionDigest,
        description: merged.effective.description,
        appliedPatches: merged.appliedPatches,
      });
    } catch (error) {
      agents.push({
        name,
        error: String(/** @type {Error} */ (error).message ?? error),
      });
    }
  }

  return {
    ok: true,
    projectRoot: paths.projectRoot,
    n: agents.length,
    agents,
  };
}

/**
 * Full run record (optionally truncated result).
 * @param {{ projectRoot: string, runId: string, full?: boolean }} input
 */
export async function showRun(input) {
  const runId = requireString(input.runId, 'runId');
  const { record, runRef } = await readRunRecord(input.projectRoot, runId);
  const full = input.full === true;
  const resultSummary =
    typeof record.resultSummary === 'string' && !full && record.resultSummary.length > 800
      ? `${record.resultSummary.slice(0, 800)}…`
      : record.resultSummary;

  return {
    ok: true,
    runRef,
    record: {
      ...record,
      resultSummary,
    },
    privacyNote:
      'Runs may contain task text and model output. .evosubagent/runs is gitignored by default; do not paste secrets into PRs.',
  };
}

/**
 * List applied patches for a subagent (newest first) + active version.
 * @param {{ projectRoot: string, name: string, limit?: number }} input
 */
export async function listVersionHistory(input) {
  const name = requireString(input.name, 'name');
  const paths = resolveProjectPaths(input.projectRoot);
  const versionState = await loadVersionState(input.projectRoot, name);
  let patchFiles = [];
  try {
    patchFiles = await readdir(paths.patchesPath);
  } catch {
    patchFiles = [];
  }

  /** @type {Array<Record<string, unknown>>} */
  const patches = [];
  for (const file of patchFiles) {
    if (!file.endsWith('.json')) continue;
    const patchRef = join(paths.patchesPath, file);
    try {
      const disk = JSON.parse(await readFile(patchRef, 'utf8'));
      if (disk.subagentName !== name) continue;
      patches.push({
        patchId: disk.patchId,
        status: disk.status,
        correction: disk.correction,
        targetKind: disk.targetKind,
        createdAt: disk.createdAt,
        transitionedAt: disk.transitionedAt,
        sourceRefs: disk.sourceRefs,
        previousVersion: disk.previousVersionState?.version,
        nextVersion: disk.nextVersionState?.version,
        patchRef,
      });
    } catch {
      /* skip */
    }
  }

  patches.sort((a, b) => {
    const ta = String(a.transitionedAt ?? a.createdAt ?? '');
    const tb = String(b.transitionedAt ?? b.createdAt ?? '');
    return tb.localeCompare(ta);
  });

  const limit = Math.max(1, Number(input.limit ?? 20) || 20);
  return {
    ok: true,
    subagentName: name,
    activeVersion: versionState.version,
    appliedPatches: versionState.appliedPatches ?? [],
    n: Math.min(limit, patches.length),
    nTotal: patches.length,
    patches: patches.slice(0, limit),
  };
}

/**
 * Diff effective body for two versions (by replaying applied chain) or last patch.
 * Stage-1: compare base merge of current vs previousVersionState, or before/after on a patch.
 *
 * @param {{
 *   projectRoot: string,
 *   name: string,
 *   patchId?: string,
 * }} input
 */
export async function diffSubagent(input) {
  const name = requireString(input.name, 'name');
  const paths = resolveProjectPaths(input.projectRoot);
  const base = await loadSubagentDefinition(input.projectRoot, name);

  if (input.patchId) {
    const patchRef = join(paths.patchesPath, `${requireString(input.patchId, 'patchId')}.json`);
    const disk = JSON.parse(await readFile(patchRef, 'utf8'));
    if (disk.subagentName !== name) {
      throw new Error(`patch belongs to ${disk.subagentName}, not ${name}`);
    }
    return {
      ok: true,
      mode: 'patch',
      subagentName: name,
      patchId: disk.patchId,
      status: disk.status,
      correction: disk.correction,
      before: disk.beforeText ?? disk.previousVersionState?.body ?? null,
      after: disk.afterText ?? disk.nextVersionState?.body ?? null,
      previousVersion: disk.previousVersionState?.version ?? null,
      nextVersion: disk.nextVersionState?.version ?? null,
      unified: unifiedDiff(
        String(disk.beforeText ?? disk.previousVersionState?.body ?? ''),
        String(disk.afterText ?? disk.nextVersionState?.body ?? ''),
      ),
    };
  }

  const currentState = await loadVersionState(input.projectRoot, name);
  const current = mergeSubagentLayers({ base, versionState: currentState });

  // Prefer last applied patch that is still applied
  const history = await listVersionHistory({ projectRoot: input.projectRoot, name, limit: 50 });
  const lastApplied = history.patches.find((p) => p.status === 'applied');
  if (lastApplied?.patchId) {
    return diffSubagent({
      projectRoot: input.projectRoot,
      name,
      patchId: String(lastApplied.patchId),
    });
  }

  return {
    ok: true,
    mode: 'current-only',
    subagentName: name,
    activeVersion: current.version,
    body: current.effective.body,
    note: 'No applied patches to diff; showing current effective body only.',
  };
}

/**
 * Minimal unified-ish line diff (no external deps).
 * @param {string} before
 * @param {string} after
 */
export function unifiedDiff(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  /** @type {string[]} */
  const lines = ['--- before', '+++ after'];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const left = a[i];
    const right = b[i];
    if (left === right) {
      if (left !== undefined) lines.push(` ${left}`);
    } else {
      if (left !== undefined) lines.push(`-${left}`);
      if (right !== undefined) lines.push(`+${right}`);
    }
  }
  return lines.join('\n');
}
