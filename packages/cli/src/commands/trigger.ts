import { attach, createStream } from "@slack-automate/core";
import { loadWorkflow } from "../workflow/loader.ts";
import { validatePayload } from "../workflow/validate.ts";
import { runWorkflow } from "../workflow/runner.ts";
import { readJsonObject } from "../workflow/json-input.ts";
import { printDryRun } from "../workflow/dry-run.ts";

export interface TriggerOpts {
  payload?: string;
  payloadFile?: string;
  port?: string;
  dryRun?: boolean;
}

export function parsePayload(opts: { payload?: string; payloadFile?: string }): Record<string, unknown> {
  return readJsonObject(opts.payload, opts.payloadFile, { inlineFlag: "--payload", fileFlag: "--payload-file" });
}

export async function triggerCommand(name: string, opts: TriggerOpts): Promise<void> {
  const payload = parsePayload(opts);
  const def = await loadWorkflow(name);
  validatePayload(def, payload);

  if (opts.dryRun) {
    printDryRun(def, payload);
    return;
  }

  const session = await attach({ port: Number(opts.port ?? "9222") });
  try {
    const stream = createStream(session);
    const out = await runWorkflow({ def, payload, session, stream });
    console.log(`triggered "${name}": function_execution_id=${out.functionExecutionId}, pages submitted=${out.pagesSubmitted}`);
  } finally {
    await session.close();
  }
}
