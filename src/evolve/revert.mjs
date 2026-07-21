import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { requireString } from '../define/schema.mjs';
import { resolveProjectPaths } from '../ledger/paths.mjs';
import { writeJsonAtomic } from './atomic-write.mjs';
import { loadVersionState, saveVersionState } from './apply.mjs';
import { transitionPatchStatus, validateEvolutionPatch } from './patch.mjs';

/**
 * Revert an applied patch by restoring previousVersionState.
 * @param {{
 *   projectRoot: string,
 *   subagentName: string,
 *   patchId: string,
 *   actorRef?: string,
 * }} input
 */
export async function revertEvolutionPatch({ projectRoot, subagentName, patchId, actorRef }) {
  const name = requireString(subagentName, 'subagentName');
  const id = requireString(patchId, 'patchId');
  const paths = resolveProjectPaths(projectRoot);
  const patchRef = join(paths.patchesPath, `${id}.json`);

  let disk;
  try {
    disk = JSON.parse(await readFile(patchRef, 'utf8'));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      throw new Error(`patch not found: ${id}`);
    }
    throw error;
  }

  const validated = validateEvolutionPatch(disk);
  if (validated.subagentName !== name) {
    throw new Error(
      `patch subagent mismatch: patch=${validated.subagentName} requested=${name}`,
    );
  }
  if (validated.status !== 'applied') {
    throw new Error(`revert requires applied patch, got ${validated.status}`);
  }
  if (!disk.previousVersionState || typeof disk.previousVersionState !== 'object') {
    throw new Error(`patch missing previousVersionState: ${id}`);
  }

  const previousVersionState = /** @type {Record<string, unknown>} */ (disk.previousVersionState);
  if (String(previousVersionState.subagentName ?? name) !== name) {
    throw new Error('previousVersionState subagentName mismatch');
  }

  const versionRef = await saveVersionState(projectRoot, {
    ...previousVersionState,
    subagentName: name,
  });

  const revertedPatch = transitionPatchStatus({
    patch: validated,
    nextStatus: 'reverted',
    reason: 'reverted to previousVersionState',
    actorRef: actorRef ?? 'host',
  });

  await writeJsonAtomic(patchRef, {
    ...disk,
    ...revertedPatch,
    previousVersionState,
    restoredVersionState: previousVersionState,
    schemaVersion: 1,
  });

  const restoredVersionState = await loadVersionState(projectRoot, name);

  return {
    appliedPatch: revertedPatch,
    restoredVersionState,
    patchRef,
    versionRef,
  };
}
