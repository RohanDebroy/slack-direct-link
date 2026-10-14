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

function canTripTrigger(raw: unknown): boolean {
  const info = (raw as { pre_trip_info?: { can_trip_trigger?: boolean } }).pre_trip_info;
  return info?.can_trip_trigger === true;
}

export async function triggersTrip(
  session: Session,
  input: TriggersTripInput,
): Promise<TriggersTripResponse> {
  const client_token = input.client_token ?? `web-${Date.now()}`;
  const trip = (run_precheck: boolean) =>
    apiCall<unknown>(session, "workflows.triggers.trip", {
      url: input.url,
      context: JSON.stringify(input.context),
      run_precheck,
      client_token,
    });

  let raw = await trip(input.run_precheck ?? true);
  let errResult = SlackError.safeParse(raw);
  // A workflow needing newly-added scopes returns `pretrip_ack_required` with a consent
  // speedbump (e.g. a step that reads a Slack list adds `lists:read`). When the backend
  // still reports the trigger can be tripped, mirror the web client: acknowledge by
  // re-tripping once with the precheck disabled.
  if (errResult.success && errResult.data.error === "pretrip_ack_required" && canTripTrigger(raw)) {
    raw = await trip(false);
    errResult = SlackError.safeParse(raw);
  }
  if (errResult.success) {
    throw new TriggersTripError(errResult.data.error ?? "unknown", raw);
  }
  return { ...TriggersTripResponse.parse(raw), client_token };
}
