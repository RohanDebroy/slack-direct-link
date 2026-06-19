import { z } from "zod";
import type { Session } from "../cdp/types.ts";
import { apiCall } from "./client.ts";

const SlackError = z.object({ ok: z.literal(false), error: z.string().optional() }).passthrough();

export class BlocksActionsError extends Error {
  constructor(public slackError: string, public raw: unknown) {
    super(`Slack API blocks.actions returned ok:false (error="${slackError}"). Raw response: ${JSON.stringify(raw)}`);
  }
}

export interface BlocksActionsContainer {
  type: string;
  message_ts: string;
  attachment_id: number;
  channel_id: string;
  is_ephemeral: boolean;
}

export interface BlocksActionsAction {
  action_id: string;
  block_id: string;
  value?: string;
  type: string;
}

export interface BlocksActionsInput {
  appId: string;
  serviceId: string;
  serviceTeamId: string;
  container: BlocksActionsContainer;
  action: BlocksActionsAction;
  state?: { values: Record<string, unknown> };
  client_token?: string;
}

export async function blocksActions(session: Session, input: BlocksActionsInput): Promise<void> {
  const client_token = input.client_token ?? `web-${Date.now()}`;
  const raw = await apiCall<unknown>(session, "blocks.actions", {
    app_id: input.appId,
    service_id: input.serviceId,
    service_team_id: input.serviceTeamId,
    container: JSON.stringify(input.container),
    actions: JSON.stringify([input.action]),
    state: JSON.stringify(input.state ?? { values: {} }),
    client_token,
  });
  const err = SlackError.safeParse(raw);
  if (err.success) throw new BlocksActionsError(err.data.error ?? "unknown", raw);
}
