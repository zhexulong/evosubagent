/**
 * Pi extension entry (stage-1 stub).
 *
 * Later: register tools/commands that call spawn/invoke + evolve/apply.
 * For now this documents the intended surface so distribution can pin it.
 */

/** @param {unknown} _pi */
export default function evosubagentPiExtension(_pi) {
  // Intentionally empty in D1 — live Pi wiring is post-PASS-demo.
  return {
    name: 'evosubagent',
    stage: 'stub',
    note: 'Materialize + evolve work via CLI; Pi hooks land after correct-once PASS.',
  };
}
