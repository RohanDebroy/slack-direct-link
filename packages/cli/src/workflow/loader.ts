import { existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkflowDefinitionSchema } from "./definition.ts";
import type { WorkflowDefinition } from "./definition.ts";

export class WorkflowNotFoundError extends Error {}
export class InvalidWorkflowError extends Error {}

// loader.ts lives at packages/cli/src/workflow/ -> repo root is four levels up.
const DEFAULT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../workflows");

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
  const file = resolve(dir, `${name}.ts`);
  if (!existsSync(file)) throw new WorkflowNotFoundError(`no workflow "${name}" at ${file}`);
  const mod = (await import(file)) as { default?: unknown };
  assertValidDefinition(mod.default, name);
  return mod.default;
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
    files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  } catch {
    return { workflows, errors };
  }
  for (const file of files.sort()) {
    const name = file.replace(/\.ts$/, "");
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
