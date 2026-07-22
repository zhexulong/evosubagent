import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { requireString } from '../define/schema.mjs';
import { resolveProjectPaths } from '../ledger/paths.mjs';
import { loadVersionState } from './apply.mjs';
import { revertEvolutionPatch } from './revert.mjs';

/**
 * Revert by target version id (user-facing), mapping to the patch that created
 * the version after that target (i.e. undo patches until active == toVersion).
 *
 * Strategy (stage-1, linear history):
 * - Find applied patches for this subagent whose nextVersionState.version is
 *   the current tip chain; repeatedly revert the patch that produced the
 *   current version until activeVersion === toVersion.
 *
 * @param {{
 *   projectRoot: string,
 *   subagentName: string,
 *   toVersion: string,
 *   actorRef?: string,
 * }} input
 */
export async function revertToVersion(input) {
  const name = requireString(input.subagentName, 'subagentName');
  const toVersion = requireString(input.toVersion, 'toVersion');
  const paths = resolveProjectPaths(input.projectRoot);

  let state = await loadVersionState(input.projectRoot, name);
  if (String(state.version) === toVersion) {
    return {
      ok: true,
      noop: true,
      subagentName: name,
      activeVersion: state.version,
      message: `already at version ${toVersion}`,
      reverted: [],
    };
  }

  let patchFiles = [];
  try {
    patchFiles = await readdir(paths.patchesPath);
  } catch {
    throw new Error('no patches directory; nothing to revert');
  }

  /** @type {Array<Record<string, unknown>>} */
  const applied = [];
  for (const file of patchFiles) {
    if (!file.endsWith('.json')) continue;
    try {
      const disk = JSON.parse(await readFile(join(paths.patchesPath, file), 'utf8'));
      if (disk.subagentName !== name) continue;
      if (disk.status !== 'applied') continue;
      applied.push(disk);
    } catch {
      /* skip */
    }
  }

  /** @type {Array<Record<string, unknown>>} */
  const reverted = [];
  const maxSteps = 32;
  for (let step = 0; step < maxSteps; step++) {
    state = await loadVersionState(input.projectRoot, name);
    if (String(state.version) === toVersion) break;

    const currentVersion = String(state.version);
    // Patch that produced current version
    const producer = applied.find(
      (p) =>
        p.status === 'applied' &&
        String(/** @type {{ nextVersionState?: { version?: string } }} */ (p).nextVersionState?.version) ===
          currentVersion,
    );
    // Re-read from disk for fresh status
    let producerDisk = producer;
    if (producer?.patchId) {
      try {
        producerDisk = JSON.parse(
          await readFile(join(paths.patchesPath, `${producer.patchId}.json`), 'utf8'),
        );
      } catch {
        producerDisk = null;
      }
    }
    if (!producerDisk || producerDisk.status !== 'applied') {
      // Fallback: last id in appliedPatches
      const ids = Array.isArray(state.appliedPatches) ? [...state.appliedPatches] : [];
      const lastId = ids[ids.length - 1];
      if (!lastId) {
        throw new Error(
          `cannot reach version ${toVersion}: no applied patch produces current ${currentVersion}`,
        );
      }
      const result = await revertEvolutionPatch({
        projectRoot: input.projectRoot,
        subagentName: name,
        patchId: String(lastId),
        actorRef: input.actorRef ?? 'cli:revert-to',
      });
      reverted.push({
        patchId: lastId,
        restoredVersion: result.restoredVersionState.version,
        correction: result.appliedPatch.correction,
      });
      // mark in-memory
      const idx = applied.findIndex((p) => p.patchId === lastId);
      if (idx >= 0) applied[idx].status = 'reverted';
      continue;
    }

    const patchId = String(producerDisk.patchId);
    const result = await revertEvolutionPatch({
      projectRoot: input.projectRoot,
      subagentName: name,
      patchId,
      actorRef: input.actorRef ?? 'cli:revert-to',
    });
    reverted.push({
      patchId,
      restoredVersion: result.restoredVersionState.version,
      correction: producerDisk.correction,
      previousVersion: producerDisk.previousVersionState?.version,
      undoneNextVersion: producerDisk.nextVersionState?.version,
    });
    producerDisk.status = 'reverted';
    const idx = applied.findIndex((p) => p.patchId === patchId);
    if (idx >= 0) applied[idx].status = 'reverted';
  }

  state = await loadVersionState(input.projectRoot, name);
  if (String(state.version) !== toVersion) {
    throw new Error(
      `revert-to incomplete: wanted ${toVersion}, active is ${state.version} after ${reverted.length} steps`,
    );
  }

  return {
    ok: true,
    noop: false,
    subagentName: name,
    activeVersion: state.version,
    reverted,
  };
}
