import { readFileSync } from "node:fs";
import { attach, createStream } from "@slack-automate/core";
import { loadWorkflow } from "../workflow/loader.ts";
import { validatePayload } from "../workflow/validate.ts";
import { runWorkflow, resolveContext } from "../workflow/runner.ts";

export interface TriggerOpts {
  payload?: string;
  payloadFile?: string;
  port?: string;
  dryRun?: boolean;
}

export function parsePayload(opts: { payload?: string; payloadFile?: string }): Record<string, unknown> {
  const hasInline = typeof opts.payload === "string";
  const hasFile = typeof opts.payloadFile === "string";
  if (hasInline === hasFile) {
    throw new Error("provide exactly one of --payload or --payload-file");
  }
  const text = hasInline ? opts.payload! : readFileSync(opts.payloadFile!, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`invalid JSON payload: ${(e as Error).message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("payload must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export async function triggerCommand(name: string, opts: TriggerOpts): Promise<void> {
  const payload = parsePayload(opts);
  const def = await loadWorkflow(name);
  validatePayload(def, payload);

  if (opts.dryRun) {
    console.log(`[dry-run] workflow "${def.name}"`);
    console.log(`[dry-run] trigger url: ${def.trigger.url}`);
    console.log(`[dry-run] context: ${JSON.stringify(resolveContext(def, payload))}`);
    def.pages.forEach((page, p) => {
      console.log(`[dry-run] page ${p}:`);
      for (const f of page.fields) {
        const present = payload[f.key] !== undefined;
        if (!present && f.optional) continue;
        const note = f.format === "fileUpload" ? ` (upload local file: ${String(payload[f.key])})` : "";
        console.log(`[dry-run]   ${f.key} [${f.format}] = ${JSON.stringify(payload[f.key])}${note}`);
      }
    });
    console.log("[dry-run] no Slack calls made");
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
