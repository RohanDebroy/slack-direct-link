import { existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WorkflowDefinitionSchema } from "./definition.ts";
import type { WorkflowDefinition } from "./definition.ts";

export class WorkflowNotFoundError extends Error {}
export class InvalidWorkflowError extends Error {}

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
/** Extensions a workflow module may have: .ts in dev (bun), .mjs/.js/.cjs in a bundled build. */
const WORKFLOW_EXTS = [".ts", ".mjs", ".js", ".cjs"];

// Resolve the workflows dir: env override, then a sibling dir (bundled dist/workflows),
// then repo-root/workflows (dev, four levels up from packages/cli/src/workflow/).
// Resolve the workflows dir (read + write target), relative to the CLI module — NOT cwd:
// SLACK_CLI_WORKFLOWS_DIR, then a sibling dir (bundled dist/workflows), then repo-root/workflows.
export function resolveWorkflowsDir(): string {
  const candidates = [
    process.env.SLACK_CLI_WORKFLOWS_DIR,
    resolve(MODULE_DIR, "workflows"),
    resolve(MODULE_DIR, "../../../../workflows"),
  ].filter((d): d is string => typeof d === "string");
  return candidates.find((d) => existsSync(d)) ?? candidates[candidates.length - 1]!;
}
const DEFAULT_DIR = resolveWorkflowsDir();

export function assertValidDefinition(def: unknown, name: string): asserts def is WorkflowDefinition {
  const result = WorkflowDefinitionSchema.safeParse(def);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new InvalidWorkflowError(`workflow "${name}" is invalid: ${detail}`);
  }
}

export async function loadWorkflow(name: string, dir: string = DEFAULT_DIR): Promise<WorkflowDefinition> {
  for (const ext of WORKFLOW_EXTS) {
    const file = resolve(dir, `${name}${ext}`);
    if (existsSync(file)) {
      const mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
      assertValidDefinition(mod.default, name);
      return mod.default;
    }
  }
  throw new WorkflowNotFoundError(`no workflow "${name}" in ${dir} (tried ${WORKFLOW_EXTS.join(", ")})`);
}

export interface WorkflowSummary {
  /** Basename to pass to `trigger <name>` (workflows/<name>.ts). */
  name: string;
  /** The definition's declared `name` (usually equal to the basename). */
  declaredName: string;
  description?: string;
  triggerUrl: string;
  channelId: string;
  pages: number;
  fields: number;
  fieldKeys: string[];
}

/** Load every workflows/*.ts, returning a summary per valid one and errors for the rest. */
export async function listWorkflows(
  dir: string = DEFAULT_DIR,
): Promise<{ workflows: WorkflowSummary[]; errors: { file: string; error: string }[] }> {
  const workflows: WorkflowSummary[] = [];
  const errors: { file: string; error: string }[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => WORKFLOW_EXTS.some((e) => f.endsWith(e)));
  } catch {
    return { workflows, errors };
  }
  const seen = new Set<string>();
  for (const file of files.sort()) {
    const name = file.replace(/\.(ts|mjs|js|cjs)$/, "");
    if (seen.has(name)) continue;
    seen.add(name);
    try {
      const def = await loadWorkflow(name, dir);
      const fieldKeys = def.pages.flatMap((p) => p.fields.map((f) => f.key));
      workflows.push({
        name,
        declaredName: def.name,
        ...(def.description !== undefined ? { description: def.description } : {}),
        triggerUrl: def.trigger.url,
        channelId: def.trigger.context.channel_id,
        pages: def.pages.length,
        fields: fieldKeys.length,
        fieldKeys,
      });
    } catch (e) {
      errors.push({ file, error: (e as Error).message });
    }
  }
  return { workflows, errors };
}
