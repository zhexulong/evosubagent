import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { requireString } from '../define/schema.mjs';
import { resolveProjectPaths } from '../ledger/paths.mjs';
import { transitionPatchStatus, validateEvolutionPatch } from './patch.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

/**
 * @param {string} version
 * @param {string} patchId
 */
export function nextVersion(version, patchId) {
  const current = requireString(version, 'version');
  if (/^\d+$/.test(current)) return String(Number(current) + 1);
  const shortId = requireString(patchId, 'patchId').replace(/[^a-zA-Z0-9]/g, '').slice(-8);
  return `${current}+patch.${shortId}`;
}

/**
 * @param {string} projectRoot
 * @param {string} subagentName
 */
export function versionStatePath(projectRoot, subagentName) {
  const paths = resolveProjectPaths(projectRoot);
  return join(paths.versionsPath, `${subagentName}.json`);
}

/**
 * @param {string} projectRoot
 * @param {string} subagentName
 */
export async function loadVersionState(projectRoot, subagentName) {
  const path = versionStatePath(projectRoot, subagentName);
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      return {
        subagentName,
        version: '1',
        appliedPatches: [],
      };
    }
    throw error;
  }
}

/**
 * @param {string} projectRoot
 * @param {Record<string, unknown>} state
 */
export async function saveVersionState(projectRoot, state) {
  const name = requireString(state.subagentName, 'state.subagentName');
  const path = versionStatePath(projectRoot, name);
  await mkdir(resolveProjectPaths(projectRoot).versionsPath, { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return path;
}

/**
 * Host apply (heritage: evolution-patch-apply.mjs).
 * @param {{
 *   projectRoot: string,
 *   patch: unknown,
 *   actorRef?: string,
 * }} input
 */
export async function applyEvolutionPatch({ projectRoot, patch, actorRef }) {
  const accepted = validateEvolutionPatch(patch);
  if (accepted.status !== 'accepted' && accepted.status !== 'proposed') {
    throw new Error(`apply requires proposed or accepted patch, got ${accepted.status}`);
  }
  // Stage-1: auto-accept proposed when applying via host CLI
  const toApply =
    accepted.status === 'proposed'
      ? transitionPatchStatus({
          patch: accepted,
          nextStatus: 'accepted',
          reason: 'accepted by host apply',
          actorRef,
        })
      : accepted;

  const previous = await loadVersionState(projectRoot, toApply.subagentName);
  const next = clone(previous);
  next.subagentName = toApply.subagentName;
  next.version = nextVersion(String(previous.version ?? '1'), toApply.patchId);
  next.appliedPatches = [...(previous.appliedPatches ?? []), toApply.patchId];

  if (toApply.targetKind === 'subagent-body') {
    next.body = toApply.afterText;
  } else if (toApply.targetKind === 'subagent-description') {
    next.description = toApply.afterText;
  }

  const appliedPatch = transitionPatchStatus({
    patch: { ...toApply, previousVersionState: previous },
    nextStatus: 'applied',
    reason: 'applied to versioned subagent state',
    actorRef: actorRef ?? 'host',
  });

  const paths = resolveProjectPaths(projectRoot);
  await mkdir(paths.patchesPath, { recursive: true });
  const patchRef = join(paths.patchesPath, `${toApply.patchId}.json`);
  await writeFile(
    patchRef,
    `${JSON.stringify({ ...appliedPatch, previousVersionState: previous, nextVersionState: next }, null, 2)}\n`,
    'utf8',
  );
  const versionRef = await saveVersionState(projectRoot, next);

  return {
    appliedPatch,
    previousVersionState: previous,
    nextVersionState: next,
    patchRef,
    versionRef,
  };
}
