import { z } from "zod";
import type { Session } from "../cdp/types.ts";
import { apiCall } from "./client.ts";

const SlackError = z.object({
  ok: z.literal(false),
  error: z.string().optional(),
}).passthrough();

export class ReactionsAddError extends Error {
  constructor(public slackError: string, public raw: unknown) {
    super(`Slack API reactions.add returned ok:false (error="${slackError}"). Raw response: ${JSON.stringify(raw)}`);
  }
}

export interface ReactionsAddInput {
  channel: string;
  /** Slack message ts, e.g. "1781616382.302439". */
  timestamp: string;
  /** Emoji name without colons, e.g. "accessibility". */
  name: string;
}

export async function reactionsAdd(session: Session, input: ReactionsAddInput): Promise<void> {
  const raw = await apiCall<unknown>(session, "reactions.add", {
    channel: input.channel,
    timestamp: input.timestamp,
    name: input.name,
  });
  const err = SlackError.safeParse(raw);
  if (err.success) throw new ReactionsAddError(err.data.error ?? "unknown", raw);
}

export async function reactionsRemove(session: Session, input: ReactionsAddInput): Promise<void> {
  const raw = await apiCall<unknown>(session, "reactions.remove", {
    channel: input.channel,
    timestamp: input.timestamp,
    name: input.name,
  });
  const err = SlackError.safeParse(raw);
  if (err.success) {
    throw new Error(`Slack API reactions.remove returned ok:false (error="${err.data.error ?? "unknown"}"). Raw response: ${JSON.stringify(raw)}`);
  }
}
