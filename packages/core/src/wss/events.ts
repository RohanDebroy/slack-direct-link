import { z } from "zod";
import type { WssFrame } from "../cdp/types.ts";

const ActionEl = z.object({
  type: z.string().optional(),
  action_id: z.string().optional(),
  value: z.string().optional(),
}).passthrough();

const AttachmentBlock = z.object({
  type: z.string().optional(),
  block_id: z.string().optional(),
  elements: z.array(ActionEl).optional(),
}).passthrough();

const MessageAttachment = z.object({
  id: z.number().optional(),
  blocks: z.array(AttachmentBlock).optional(),
}).passthrough();

const Message = z.object({
  type: z.literal("message"),
  channel: z.string(),
  user: z.string().optional(),
  text: z.string().optional(),
  ts: z.string(),
  subtype: z.string().optional(),
  app_id: z.string().optional(),
  bot_id: z.string().optional(),
  team: z.string().optional(),
  attachments: z.array(MessageAttachment).optional(),
}).passthrough();

const ViewOpenedBlock = z.object({
  block_id: z.string(),
  element: z.object({ action_id: z.string().optional() }).passthrough().optional(),
}).passthrough();

const ViewOpened = z.object({
  type: z.literal("view_opened"),
  view_id: z.string(),
  client_token: z.string().optional(),
  trigger_execution_id: z.string().optional(),
  // Slack regenerates block_ids per view instance; the action_ids are stable. The
  // caller needs the live blocks to map action_id -> block_id before submitting.
  view: z.object({
    id: z.string(),
    blocks: z.array(ViewOpenedBlock).optional(),
  }).passthrough().optional(),
}).passthrough();

export const SlackEvent = z.discriminatedUnion("type", [Message, ViewOpened]);
export type SlackEvent = z.infer<typeof SlackEvent>;

/** Returns null for frames we don't care about (other event types, control frames). */
export function parseFrame(frame: WssFrame): SlackEvent | null {
  if (frame.response.opcode !== 1) return null;
  let raw: unknown;
  try { raw = JSON.parse(frame.response.payloadData); } catch { return null; }
  const r = SlackEvent.safeParse(raw);
  return r.success ? r.data : null;
}
