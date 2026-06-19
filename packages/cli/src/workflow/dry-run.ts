import { resolveContext } from "./runner.ts";
import type { WorkflowDefinition } from "./definition.ts";

/** Print the resolved trigger context and per-page field values without calling Slack. */
export function printDryRun(def: WorkflowDefinition, payload: Record<string, unknown>): void {
  console.log(`[dry-run] workflow "${def.name}"`);
  console.log(`[dry-run] trigger url: ${def.trigger.url}`);
  console.log(`[dry-run] context: ${JSON.stringify(resolveContext(def, payload))}`);
  def.pages.forEach((page, p) => {
    console.log(`[dry-run] page ${p}:`);
    for (const f of page.fields) {
      const present = payload[f.key] !== undefined;
      if (!present && f.optional) continue;
      const v = payload[f.key];
      const note = f.format === "fileUpload" ? ` (upload: ${Array.isArray(v) ? v.join(", ") : String(v)})` : "";
      console.log(`[dry-run]   ${f.key} [${f.format}] = ${JSON.stringify(payload[f.key])}${note}`);
    }
  });
  console.log("[dry-run] no Slack calls made");
}
