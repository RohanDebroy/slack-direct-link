import { listWorkflows } from "../workflow/loader.ts";

export interface ListOpts {
  json?: boolean;
}

/** List every workflow in workflows/ with identifying metadata. */
export async function listCommand(opts: ListOpts): Promise<void> {
  const { workflows, errors } = await listWorkflows();

  if (opts.json) {
    console.log(JSON.stringify({ workflows, errors }, null, 2));
    return;
  }

  if (workflows.length === 0) {
    console.log("no workflows found in workflows/");
  }
  for (const w of workflows) {
    const declared = w.declaredName !== w.name ? ` (name: "${w.declaredName}")` : "";
    console.log(`${w.name}${declared}`);
    if (w.description) console.log(`  ${w.description}`);
    console.log(`  pages: ${w.pages}  fields: ${w.fields}  channel: ${w.channelId}`);
    console.log(`  trigger: ${w.triggerUrl}`);
    console.log("");
  }
  for (const e of errors) {
    console.error(`! skipped ${e.file}: ${e.error}`);
  }
}
