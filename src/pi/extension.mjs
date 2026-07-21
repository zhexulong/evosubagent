/**
 * Pi extension entry (MVP).
 *
 * Load (Pi-version dependent — pin your Pi version in project docs):
 *   export EVOSUBAGENT_PROJECT=/path/to/project
 *   pi -e ./src/pi/extension.mjs
 *
 * Default runtime: pi-first-stub (CI-safe).
 * Live child: EVOSUBAGENT_LIVE=1 and runtime pi-child / EVOSUBAGENT_RUNTIME=pi-child.
 *
 * Tool registration is best-effort across Pi API shapes:
 * - pi.registerTool(name, def)
 * - pi.registerTool({ name, ...def })
 * - fallback: pi.evosubagentTools = tools
 *
 * @see scripts/live-pi-invoke.md
 */

import { resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { invokeSubagent } from '../spawn/invoke.mjs';
import { loadSubagentDefinition } from '../define/load.mjs';
import { loadVersionState } from '../evolve/apply.mjs';
import { mergeSubagentLayers } from '../layers/merge.mjs';
import { resolveProjectPaths } from '../ledger/paths.mjs';

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
 * @param {Record<string, unknown>} tools
 * @param {any} pi
 */
function registerToolsBestEffort(pi, tools) {
  if (!pi || typeof pi !== 'object') return 'none';
  if (typeof pi.registerTool === 'function') {
    for (const [name, tool] of Object.entries(tools)) {
      try {
        pi.registerTool(name, tool);
      } catch {
        try {
          pi.registerTool({ name, .../** @type {object} */ (tool) });
        } catch {
          // continue
        }
      }
    }
    return 'registerTool';
  }
  pi.evosubagentTools = tools;
  return 'evosubagentTools';
}

/**
 * @param {any} pi
 */
export default function evosubagentPiExtension(pi) {
  const projectRoot = resolve(process.env.EVOSUBAGENT_PROJECT ?? process.cwd());

  const tools = {
    evosubagent_list: {
      description: 'List project EvoSubagent names with active versions',
      parameters: { type: 'object', properties: {} },
      async execute() {
        const agents = await listSubagents(projectRoot);
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: true, projectRoot, agents }, null, 2) }],
        };
      },
    },
    evosubagent_invoke: {
      description: 'Materialize active subagent version, run (stub or pi-child), write ledger',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          task: { type: 'string' },
          runtime: { type: 'string', description: 'pi-first-stub | pi-child' },
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
                  ok: result.ok,
                  runRef: result.runRef,
                  status: result.record.status,
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
        properties: { name: { type: 'string' } },
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

  const registration = registerToolsBestEffort(pi, tools);

  return {
    name: 'evosubagent',
    stage: 'mvp',
    tools: Object.keys(tools),
    registration,
    note: 'Default runtime pi-first-stub; set EVOSUBAGENT_LIVE=1 and runtime pi-child for live model.',
  };
}
