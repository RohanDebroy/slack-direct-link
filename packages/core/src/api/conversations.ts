import { z } from "zod";
import type { Session } from "../cdp/types.ts";
import { apiCall } from "./client.ts";

const SlackError = z.object({
  ok: z.literal(false),
  error: z.string().optional(),
}).passthrough();

const ListResp = z.object({
  ok: z.literal(true),
  channels: z.array(
    z.object({
      id: z.string(),
      name: z.string().optional(),
      is_im: z.boolean().optional(),
    }).passthrough(),
  ),
});

export class SlackApiError extends Error {
  constructor(public path: string, public slackError: string, public raw: unknown) {
    super(`Slack API ${path} returned ok:false (error="${slackError}"). The xoxc session may lack the scope or the endpoint may not be exposed to the web client.`);
  }
}

export interface ChannelMap {
  byName: Map<string, string>; // "ch-a11y-eng" -> "C..."
  byId: Map<string, string>;   // "C..." -> "ch-a11y-eng"
  ims: Set<string>;            // im channel ids
}

export async function conversationsList(session: Session): Promise<ChannelMap> {
  const raw = await apiCall<unknown>(session, "conversations.list", {
    types: "public_channel,private_channel,im",
    limit: 1000,
  });
  const errResult = SlackError.safeParse(raw);
  if (errResult.success) {
    throw new SlackApiError("conversations.list", errResult.data.error ?? "unknown", raw);
  }
  const parsed = ListResp.parse(raw);

  const byName = new Map<string, string>();
  const byId = new Map<string, string>();
  const ims = new Set<string>();
  for (const c of parsed.channels) {
    if (c.is_im) ims.add(c.id);
    if (c.name) {
      byName.set(c.name, c.id);
      byId.set(c.id, c.name);
    }
  }
  return { byName, byId, ims };
}

export async function conversationsMark(
  session: Session,
  input: { channel: string; ts: string },
): Promise<void> {
  await apiCall<{ ok: boolean }>(session, "conversations.mark", input);
}
