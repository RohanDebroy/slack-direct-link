import type { ViewsSubmitResponse } from "@slack-automate/core";

/** Built-in value formatters. Maps a payload value to a Slack view-state value. */
export type Format =
  | "plain"               // plain_text_input
  | "bulletText"          // rich_text_input, single bullet of plain text
  | "bulletLink"          // rich_text_input, single bullet containing a link
  | "richText"            // rich_text_input, single plain-text section (no bullet)
  | "multiConversations"  // multi_conversations_select (expects string[])
  | "conversation"        // conversations_select (expects string)
  | "fileUpload";         // upload a local file, link the returned id as file_input

export interface FieldDef {
  /** Key looked up in the payload. For `fileUpload`, the value is a local file path. */
  key: string;
  /** Slack action_id — stable across view instances (block_ids are not). */
  actionId: string;
  format: Format;
  /** When true, the field is skipped if the payload omits its key. Default: required. */
  optional?: boolean;
}

export interface PageDef {
  fields: FieldDef[];
}

export interface TriggerContext {
  location: string;
  channel_id: string;
}

export interface TriggerDef {
  url: string;
  context: TriggerContext;
}

export interface WorkflowDefinition {
  name: string;
  trigger: TriggerDef;
  /** Ordered modal pages. One page = one view_opened -> views.submit cycle. */
  pages: PageDef[];

  // ---- optional hooks (escape hatch for custom workflows) ----
  /** Override the built-in formatter for a field. Return the Slack view-state value. */
  formatValue?(field: FieldDef, raw: unknown): unknown;
  /** Derive the trigger context from the payload (overrides trigger.context). */
  buildContext?(payload: Record<string, unknown>): TriggerContext;
  /** Decide whether to advance to the next page. Default: response_action is push/update. */
  shouldContinue?(resp: ViewsSubmitResponse): boolean;
}
