import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { resolveWorkflowsDir } from "../workflow/loader.ts";
import { attach, createStream, triggersTrip, waitFor, conversationsList } from "@slack-automate/core";
import type { Session } from "@slack-automate/core";
import type { SlackEvent } from "@slack-automate/core";
import { viewToDefinition, definitionToSource, type ExtractableView } from "../workflow/extract.ts";

type ViewOpened = Extract<SlackEvent, { type: "view_opened" }>;

export interface ExtractOpts {
  name: string;
  channel: string;
  port?: string;
  out?: string;
  /** Emit a reaction trigger instead of a shortcut trigger (the url is still tripped to capture the modal). */
  reaction?: string;
  /** Workflow bot app id, required when --reaction is given. */
  appId?: string;
}

/**
 * Trip a workflow trigger, capture the live view_opened modal, and write a
 * scaffolded single-page WorkflowDefinition. The modal is never submitted, so
 * nothing is posted to Slack.
 */
function looksLikeChannelId(value: string): boolean {
  return /^[CGD][A-Z0-9]{6,}$/.test(value);
}

/** Accept a channel id (C…/G…/D…) directly, or resolve a #name via conversations.list. */
async function resolveChannelId(session: Session, channel: string): Promise<string> {
  if (looksLikeChannelId(channel)) return channel;
  const name = channel.replace(/^#/, "");
  const map = await conversationsList(session);
  const id = map.byName.get(name);
  if (!id) throw new Error(`channel "${name}" not found via conversations.list (check the exact name and that you are a member)`);
  return id;
}

export async function extractCommand(url: string, opts: ExtractOpts): Promise<void> {
  if (opts.reaction && !opts.appId) {
    throw new Error("--reaction requires --app-id (the workflow bot's app id, e.g. A092KLW9XXX)");
  }
  const session = await attach({ port: Number(opts.port ?? "9222") });
  try {
    const channelId = await resolveChannelId(session, opts.channel);
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
      context: { location: "slash_command", channel_id: channelId },
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
      channelId,
      ...(opts.reaction ? { reaction: { emoji: opts.reaction, appId: opts.appId! } } : {}),
    });

    // Write into the dir the loader reads from (relative to the CLI, NOT cwd), in a
    // format the current runtime can import: .ts under Bun, plain ESM .mjs under Node.
    const ext = typeof process.versions.bun === "string" ? ".ts" : ".mjs";
    const outPath = opts.out ? resolve(opts.out) : resolve(resolveWorkflowsDir(), `${opts.name}${ext}`);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, definitionToSource(definition, warnings, { typescript: outPath.endsWith(".ts") }), "utf8");

    const triggerNote = opts.reaction
      ? `reaction :${opts.reaction}: trigger (app ${opts.appId}) — edit _message/_channel at trigger time`
      : "shortcut trigger";
    console.log(`extracted ${definition.pages[0]!.fields.length} field(s) -> ${outPath} (${triggerNote}; modal not submitted)`);
    for (const w of warnings) console.log(`  warning: ${w}`);
  } finally {
    await session.close();
  }
}
