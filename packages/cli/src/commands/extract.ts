import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { attach, createStream, triggersTrip, waitFor } from "@slack-automate/core";
import type { SlackEvent } from "@slack-automate/core";
import { viewToDefinition, definitionToSource, type ExtractableView } from "../workflow/extract.ts";

type ViewOpened = Extract<SlackEvent, { type: "view_opened" }>;

export interface ExtractOpts {
  name: string;
  channel: string;
  port?: string;
  out?: string;
}

/**
 * Trip a workflow trigger, capture the live view_opened modal, and write a
 * scaffolded single-page WorkflowDefinition. The modal is never submitted, so
 * nothing is posted to Slack.
 */
export async function extractCommand(url: string, opts: ExtractOpts): Promise<void> {
  const session = await attach({ port: Number(opts.port ?? "9222") });
  try {
    const stream = createStream(session);

    // Subscribe before tripping (the view_opened frame can arrive before the HTTP response).
    const client_token = `web-${Date.now()}`;
    const viewPromise = waitFor(
      stream,
      (e: SlackEvent): e is ViewOpened => e.type === "view_opened" && e.client_token === client_token,
      { timeout: 15_000 },
    );

    await triggersTrip(session, {
      url,
      context: { location: "slash_command", channel_id: opts.channel },
      run_precheck: true,
      client_token,
    });

    const event = await viewPromise;
    // core types view blocks via a Zod passthrough schema, so element.type is
    // statically unknown though present at runtime — cast at this boundary.
    const view = (event.view ?? {}) as unknown as ExtractableView;
    const { definition, warnings } = viewToDefinition(view, {
      name: opts.name,
      url,
      channelId: opts.channel,
    });

    const outPath = resolve(opts.out ?? `workflows/${opts.name}.ts`);
    writeFileSync(outPath, definitionToSource(definition, warnings), "utf8");

    console.log(`extracted ${definition.pages[0]!.fields.length} field(s) -> ${outPath} (modal not submitted)`);
    for (const w of warnings) console.log(`  warning: ${w}`);
  } finally {
    await session.close();
  }
}
