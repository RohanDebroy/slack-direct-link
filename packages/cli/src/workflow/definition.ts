import { z } from "zod";
import type { ViewsSubmitResponse } from "@slack-automate/core";

/**
 * Built-in value formatters (maps a payload value to a Slack view-state value).
 * The zod enum is the single source of truth; `Format` and the runtime
 * `FORMATS` list are derived from it so they can never drift apart.
 *   plain               -> plain_text_input
 *   bulletText          -> rich_text_input, single bullet of plain text
 *   bulletLink          -> rich_text_input, single bullet containing a link
 *   richText            -> rich_text_input, single plain-text section (no bullet)
 *   multiConversations  -> multi_conversations_select (expects string[])
 *   conversation        -> conversations_select (expects string)
 *   fileUpload          -> upload a local file, link the returned id as file_input
 */
export const FormatSchema = z.enum([
  "plain",
  "bulletText",
  "bulletLink",
  "link",
  "richText",
  "multiConversations",
  "conversation",
  "fileUpload",
  "checkboxes",
]);
export type Format = z.infer<typeof FormatSchema>;
/** Runtime list of valid formats, derived from the schema. */
export const FORMATS = FormatSchema.options;

export const CheckboxOptionSchema = z
  .object({
    text: z.object({ type: z.string(), text: z.string() }).passthrough(),
    value: z.string(),
  })
  .passthrough();
export type CheckboxOption = z.infer<typeof CheckboxOptionSchema>;

export const FieldDefSchema = z.object({
  /** Key looked up in the payload. For `fileUpload`, the value is a local file path. */
  key: z.string().min(1),
  /** Slack action_id — stable across view instances (block_ids are not). */
  actionId: z.string().min(1),
  format: FormatSchema,
  /** When true, the field is skipped if the payload omits its key. Default: required. */
  optional: z.boolean().optional(),
  /** When true (richText/bulletText only), pasted URLs become highlighted link elements. */
  autolink: z.boolean().optional(),
  /** Option catalog for `checkboxes` fields (captured from the modal by `extract`). */
  options: z.array(CheckboxOptionSchema).optional(),
});
export type FieldDef = z.infer<typeof FieldDefSchema>;

export const PageDefSchema = z.object({ fields: z.array(FieldDefSchema) });
export type PageDef = z.infer<typeof PageDefSchema>;

export const TriggerContextSchema = z.object({ location: z.string(), channel_id: z.string() });
export type TriggerContext = z.infer<typeof TriggerContextSchema>;

/** Shortcut/link trigger (the original kind). `kind` omitted ⇒ treated as shortcut. */
export const ShortcutTriggerSchema = z.object({
  kind: z.literal("shortcut").optional(),
  url: z.string(),
  context: TriggerContextSchema,
});
export type ShortcutTrigger = z.infer<typeof ShortcutTriggerSchema>;

/** Reaction (event) trigger: react with `emoji`; `appId` identifies the bot's Continue DM. */
export const ReactionTriggerSchema = z.object({
  kind: z.literal("reaction"),
  emoji: z.string().min(1),
  appId: z.string().min(1),
});
export type ReactionTrigger = z.infer<typeof ReactionTriggerSchema>;

// Reaction first: it carries an explicit `kind`; a shortcut object (kind absent) matches the second.
export const TriggerDefSchema = z.union([ReactionTriggerSchema, ShortcutTriggerSchema]);
export type TriggerDef = z.infer<typeof TriggerDefSchema>;

export function isReactionTrigger(t: TriggerDef): t is ReactionTrigger {
  return (t as { kind?: string }).kind === "reaction";
}

/** The serialisable (JSON-expressible) part of a workflow definition. */
export const WorkflowDefinitionSchema = z.object({
  name: z.string().min(1),
  /** Optional human-readable note, surfaced by `slack-cli list` for identification. */
  description: z.string().optional(),
  trigger: TriggerDefSchema,
  /** Ordered modal pages. One page = one view_opened -> views.submit cycle. */
  pages: z.array(PageDefSchema).min(1),
});
export type WorkflowDefinitionData = z.infer<typeof WorkflowDefinitionSchema>;

/**
 * A workflow definition: the schema-validated data plus optional code-only hooks.
 * The hooks are functions, so they can't be expressed in JSON — definitions loaded
 * from JSON (the `run` command) are data-only; TS modules in workflows/ may add hooks.
 */
export interface WorkflowDefinition extends WorkflowDefinitionData {
  /** Override the built-in formatter for a field. Return the Slack view-state value. */
  formatValue?(field: FieldDef, raw: unknown): unknown;
  /** Derive the trigger context from the payload (overrides trigger.context). */
  buildContext?(payload: Record<string, unknown>): TriggerContext;
  /** Decide whether to advance to the next page. Default: response_action is push/update. */
  shouldContinue?(resp: ViewsSubmitResponse): boolean;
}
