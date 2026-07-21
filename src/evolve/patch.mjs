import { requireObject, requireString } from '../define/schema.mjs';

const TARGET_KINDS = new Set(['subagent-body', 'subagent-description']);
const STATUSES = new Set(['proposed', 'accepted', 'applied', 'rejected', 'reverted']);

/**
 * @param {unknown} input
 */
export function validateEvolutionPatch(input) {
  requireObject(input, 'patch');
  const p = /** @type {Record<string, unknown>} */ (input);
  const patchId = requireString(p.patchId, 'patch.patchId');
  const subagentName = requireString(p.subagentName, 'patch.subagentName');
  const targetKind = requireString(p.targetKind, 'patch.targetKind');
  if (!TARGET_KINDS.has(targetKind)) {
    throw new Error(`unsupported targetKind: ${targetKind}`);
  }
  const status = requireString(p.status ?? 'proposed', 'patch.status');
  if (!STATUSES.has(status)) {
    throw new Error(`invalid patch status: ${status}`);
  }
  const correction = requireString(p.correction, 'patch.correction');
  const afterText = requireString(p.afterText, 'patch.afterText');
  const sourceRefs = Array.isArray(p.sourceRefs) ? p.sourceRefs.map(String) : [];

  return {
    patchId,
    subagentName,
    targetKind,
    status,
    correction,
    afterText,
    beforeText: typeof p.beforeText === 'string' ? p.beforeText : '',
    sourceRefs,
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
    actorRef: typeof p.actorRef === 'string' ? p.actorRef : 'host',
  };
}

/**
 * @param {{ patch: ReturnType<typeof validateEvolutionPatch>, nextStatus: string, reason?: string, actorRef?: string }} input
 */
export function transitionPatchStatus({ patch, nextStatus, reason, actorRef }) {
  const current = validateEvolutionPatch(patch);
  if (!STATUSES.has(nextStatus)) throw new Error(`invalid nextStatus: ${nextStatus}`);
  return {
    ...current,
    status: nextStatus,
    statusReason: reason ?? '',
    actorRef: actorRef ?? current.actorRef,
    transitionedAt: new Date().toISOString(),
  };
}

/**
 * Build a simple accepted body/description patch from a correction string.
 * Stage-1 host strategy: replace body (or description) with afterText provided by caller.
 *
 * @param {{
 *   subagentName: string,
 *   targetKind?: 'subagent-body' | 'subagent-description',
 *   correction: string,
 *   beforeText: string,
 *   afterText: string,
 *   sourceRefs?: string[],
 *   patchId?: string,
 * }} input
 */
export function createAcceptedPatch(input) {
  const patchId = input.patchId ?? `patch-${Date.now().toString(36)}`;
  return validateEvolutionPatch({
    patchId,
    subagentName: input.subagentName,
    targetKind: input.targetKind ?? 'subagent-body',
    status: 'accepted',
    correction: input.correction,
    beforeText: input.beforeText,
    afterText: input.afterText,
    sourceRefs: input.sourceRefs ?? [],
    actorRef: 'host',
  });
}
