import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkflowDefinition } from "./definition.ts";

export class WorkflowNotFoundError extends Error {}
export class InvalidWorkflowError extends Error {}

// loader.ts lives at packages/cli/src/workflow/ -> repo root is four levels up.
const DEFAULT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../workflows");

function assertValid(def: unknown, name: string): asserts def is WorkflowDefinition {
  const d = def as Partial<WorkflowDefinition> | undefined;
  if (!d || typeof d !== "object") throw new InvalidWorkflowError(`workflow "${name}" has no default export object`);
  if (typeof d.name !== "string") throw new InvalidWorkflowError(`workflow "${name}" missing string "name"`);
  if (!d.trigger || typeof d.trigger.url !== "string" || !d.trigger.context || typeof d.trigger.context.channel_id !== "string") {
    throw new InvalidWorkflowError(`workflow "${name}" has an invalid "trigger"`);
  }
  if (!Array.isArray(d.pages) || d.pages.length === 0) {
    throw new InvalidWorkflowError(`workflow "${name}" must have at least one page`);
  }
  for (const page of d.pages) {
    if (!Array.isArray(page.fields)) throw new InvalidWorkflowError(`workflow "${name}" has a page without "fields"`);
    for (const f of page.fields) {
      if (typeof f.key !== "string" || typeof f.actionId !== "string" || typeof f.format !== "string") {
        throw new InvalidWorkflowError(`workflow "${name}" has a field missing key/actionId/format`);
      }
    }
  }
}

export async function loadWorkflow(name: string, dir: string = DEFAULT_DIR): Promise<WorkflowDefinition> {
  const file = resolve(dir, `${name}.ts`);
  if (!existsSync(file)) throw new WorkflowNotFoundError(`no workflow "${name}" at ${file}`);
  const mod = (await import(file)) as { default?: unknown };
  assertValid(mod.default, name);
  return mod.default;
}
