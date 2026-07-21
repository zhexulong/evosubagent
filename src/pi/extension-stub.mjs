/**
 * Pi extension entry (stage-1).
 *
 * Default: register tools that call hermetic invoke (CI-safe).
 * Live child path: set EVOSUBAGENT_LIVE=1 and invoke with runtime pi-child
 * (or EVOSUBAGENT_RUNTIME=pi-child).
 *
 * Usage (when Pi supports -e / extension load — exact flag TBD by Pi version):
 *   pi -e ./src/pi/extension-stub.mjs
 */

import { resolve } from 'node:path';
import { invokeSubagent } from '../spawn/invoke.mjs';
import { loadSubagentDefinition } from '../define/load.mjs';
import { loadVersionState } from '../evolve/apply.mjs';
import { mergeSubagentLayers } from '../layers/merge.mjs';
import { resolveProjectPaths } from '../ledger/paths.mjs';
import { readdir } from 'node:fs/promises';

/**
 * @param {string} projectRoot
 */
async function listSubagents(projectRoot) {
  const paths = resolveProjectPaths(projectRoot);
  let names = [];
  try {
    const entries = await readdir(paths.subagentsPath, { withFileTypes: true });
    names = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    names = [];
  }
  /** @type {{ name: string, activeVersion: string, definitionDigest: string }[]} */
  const out = [];
  for (const name of names) {
    try {
      const base = await loadSubagentDefinition(projectRoot, name);
      const versionState = await loadVersionState(projectRoot, name);
      const merged = mergeSubagentLayers({ base, versionState });
      out.push({
        name,
        activeVersion: merged.version,
        definitionDigest: merged.definitionDigest,
      });
    } catch {
      out.push({ name, activeVersion: '?', definitionDigest: '' });
    }
  }
  return out;
}

/**
 * @param {any} pi Pi extension API (shape varies; we stay defensive)
 */
export default function evosubagentPiExtension(pi) {
  const projectRoot = resolve(
    process.env.EVOSUBAGENT_PROJECT ?? process.cwd(),
  );

  const tools = {
    evosubagent_list: {
      description: 'List project EvoSubagent names with active versions',
      parameters: {
        type: 'object',
        properties: {},
      },
      async execute() {
        const agents = await listSubagents(projectRoot);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, projectRoot, agents }, null, 2) }] };
      },
    },
    evosubagent_invoke: {
      description: 'Materialize active subagent version, run (stub or pi-child), write ledger',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Subagent name' },
          task: { type: 'string', description: 'Task text for the child' },
          runtime: {
            type: 'string',
            description: "pi-first-stub (default) or pi-child",
          },
        },
        required: ['name', 'task'],
      },
      /**
       * @param {{ name: string, task: string, runtime?: string }} args
       */
      async execute(args) {
        const runtime =
          args.runtime === 'pi-child' || process.env.EVOSUBAGENT_RUNTIME === 'pi-child'
            ? 'pi-child'
            : 'pi-first-stub';
        const result = await invokeSubagent({
          projectRoot,
          subagentName: args.name,
          task: args.task,
          runtime,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ok: true,
                  runRef: result.runRef,
                  activeVersion: result.record.activeVersion,
                  definitionDigest: result.record.definitionDigest,
                  runtime: result.record.runtime,
                  resultSummary: result.resultSummary,
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    },
    evosubagent_doctor: {
      description: 'Show active version + digests for a subagent',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      },
      /**
       * @param {{ name: string }} args
       */
      async execute(args) {
        const base = await loadSubagentDefinition(projectRoot, args.name);
        const versionState = await loadVersionState(projectRoot, args.name);
        const merged = mergeSubagentLayers({ base, versionState });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ok: true,
                  projectRoot,
                  subagentName: args.name,
                  activeVersion: merged.version,
                  definitionDigest: merged.definitionDigest,
                  appliedPatches: merged.appliedPatches,
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    },
  };

  // Best-effort registration depending on Pi host shape
  if (pi && typeof pi.registerTool === 'function') {
    for (const [name, tool] of Object.entries(tools)) {
      pi.registerTool(name, tool);
    }
  } else if (pi && typeof pi === 'object') {
    pi.evosubagentTools = tools;
  }

  return {
    name: 'evosubagent',
    stage: 'mvp',
    tools: Object.keys(tools),
    note: 'Default runtime pi-first-stub; set EVOSUBAGENT_LIVE=1 and runtime pi-child for live model.',
  };
}
