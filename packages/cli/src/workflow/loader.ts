import { existsSync } from "node:fs";
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
