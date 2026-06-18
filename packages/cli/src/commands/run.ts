import { attach, createStream } from "@slack-automate/core";
import { assertValidDefinition } from "../workflow/loader.ts";
import { validatePayload } from "../workflow/validate.ts";
import { runWorkflow } from "../workflow/runner.ts";
import { readJsonObject } from "../workflow/json-input.ts";
import { printDryRun } from "../workflow/dry-run.ts";
import type { WorkflowDefinition } from "../workflow/definition.ts";

export interface RunOpts {
  workflow?: string;
  workflowFile?: string;
  payload?: string;
  payloadFile?: string;
  port?: string;
  dryRun?: boolean;
}

/**
 * Trigger a workflow whose definition is supplied at runtime as JSON (not loaded
 * from workflows/). Definition and payload are both validated before any Slack
 * call, then executed over CDP via the same runner as `trigger`.
 */
export async function runCommand(opts: RunOpts): Promise<void> {
  const rawDef = readJsonObject(opts.workflow, opts.workflowFile, {
    inlineFlag: "--workflow",
    fileFlag: "--workflow-file",
  });
  assertValidDefinition(rawDef, opts.workflowFile ?? "inline workflow");
  const def = rawDef as WorkflowDefinition;

  const payload = readJsonObject(opts.payload, opts.payloadFile, {
    inlineFlag: "--payload",
    fileFlag: "--payload-file",
  });
  validatePayload(def, payload);

  if (opts.dryRun) {
    printDryRun(def, payload);
    return;
  }

  const session = await attach({ port: Number(opts.port ?? "9222") });
  try {
    const stream = createStream(session);
    const out = await runWorkflow({ def, payload, session, stream });
    console.log(`triggered "${def.name}": function_execution_id=${out.functionExecutionId}, pages submitted=${out.pagesSubmitted}`);
  } finally {
    await session.close();
  }
}
