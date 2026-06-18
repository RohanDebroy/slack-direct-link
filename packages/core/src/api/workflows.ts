import { z } from "zod";
import type { Session } from "../cdp/types.ts";
import { apiCall } from "./client.ts";

const SlackError = z.object({
  ok: z.literal(false),
  error: z.string().optional(),
}).passthrough();

export const TriggersTripResponse = z.object({
  ok: z.literal(true),
  is_slow_workflow: z.boolean().optional(),
  contains_ai_steps: z.boolean().optional(),
  function_execution_id: z.string(),
  trigger_execution_id: z.string(),
});
export type TriggersTripResponse = z.infer<typeof TriggersTripResponse> & { client_token: string };

export class TriggersTripError extends Error {
  constructor(public slackError: string, public raw: unknown) {
    super(`Slack API workflows.triggers.trip returned ok:false (error="${slackError}"). Raw response: ${JSON.stringify(raw)}`);
  }
}

export interface TriggersTripInput {
  url: string;
  context: { location: string; channel_id: string };
  run_precheck?: boolean;
  /**
   * Per-action idempotency tag matching Slack web client format `web-${Date.now()}`.
   * If omitted, one is generated. Pre-generate and pass it when you need to subscribe
   * to the matching `view_opened` WSS frame before the trip resolves (avoids a race).
   */
  client_token?: string;
}

export async function triggersTrip(
  session: Session,
  input: TriggersTripInput,
): Promise<TriggersTripResponse> {
  const client_token = input.client_token ?? `web-${Date.now()}`;
  const raw = await apiCall<unknown>(session, "workflows.triggers.trip", {
    url: input.url,
    context: JSON.stringify(input.context),
    run_precheck: input.run_precheck ?? true,
    client_token,
  });
  const errResult = SlackError.safeParse(raw);
  if (errResult.success) {
    throw new TriggersTripError(errResult.data.error ?? "unknown", raw);
  }
  return { ...TriggersTripResponse.parse(raw), client_token };
}
