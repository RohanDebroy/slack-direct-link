import { z } from "zod";
import type { Session } from "../cdp/types.ts";
import { apiCall } from "./client.ts";

const SlackError = z.object({
  ok: z.literal(false),
  error: z.string().optional(),
}).passthrough();

const View = z.object({
  id: z.string(),
  type: z.string(),
  callback_id: z.string().optional(),
  blocks: z.array(z.unknown()),
  title: z.object({ type: z.string(), text: z.string() }).optional(),
  hash: z.string().optional(),
}).passthrough();
export type View = z.infer<typeof View>;

export const ViewsGetResponse = z.object({
  ok: z.literal(true),
  view: View,
});
export type ViewsGetResponse = z.infer<typeof ViewsGetResponse>;

export const ViewsSubmitResponse = z.object({
  ok: z.literal(true),
  view: z.null().optional(),
  response_action: z.string(),
});
export type ViewsSubmitResponse = z.infer<typeof ViewsSubmitResponse>;

export class ViewsSubmitError extends Error {
  constructor(public slackError: string, public raw: unknown) {
    super(`Slack API views.submit returned ok:false (error="${slackError}"). Raw response: ${JSON.stringify(raw)}`);
  }
}

export async function viewsGet(session: Session, viewId: string): Promise<ViewsGetResponse> {
  const raw = await apiCall<unknown>(session, "views.get", { view_id: viewId });
  return ViewsGetResponse.parse(raw);
}

export async function viewsSubmit(
  session: Session,
  input: { view_id: string; state: { values: Record<string, unknown> } },
): Promise<ViewsSubmitResponse> {
  const raw = await apiCall<unknown>(session, "views.submit", {
    view_id: input.view_id,
    state: JSON.stringify(input.state),
    client_token: `web-${Date.now()}`,
  });
  const errResult = SlackError.safeParse(raw);
  if (errResult.success) {
    throw new ViewsSubmitError(errResult.data.error ?? "unknown", raw);
  }
  return ViewsSubmitResponse.parse(raw);
}
