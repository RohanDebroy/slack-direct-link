import type { FieldDef, PageDef, WorkflowDefinition } from "./definition.ts";

interface OpenedBlock {
  block_id: string;
  element?: { action_id?: string | undefined } | undefined;
}

/** Slack regenerates block_ids per view instance; action_ids are stable. */
export function blockIdMap(blocks: OpenedBlock[] | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const b of blocks ?? []) {
    const aid = b.element?.action_id;
    if (aid) m.set(aid, b.block_id);
  }
  return m;
}

const plain = (text: string) => ({ type: "plain_text_input" as const, value: text });

const bulletLink = (url: string) => ({
  type: "rich_text_input" as const,
  rich_text_value: {
    type: "rich_text",
    elements: [{
      type: "rich_text_list", style: "bullet", indent: 0, border: 0,
      elements: [{ type: "rich_text_section", elements: [{ type: "link", url }] }],
    }],
  },
});

const bulletText = (text: string) => ({
  type: "rich_text_input" as const,
  rich_text_value: {
    type: "rich_text",
    elements: [{
      type: "rich_text_list", style: "bullet", indent: 0, border: 0,
      elements: [{ type: "rich_text_section", elements: [{ type: "text", text }] }],
    }],
  },
});

function defaultFormat(field: FieldDef, raw: unknown): unknown {
  switch (field.format) {
    case "plain": return plain(String(raw));
    case "bulletText": return bulletText(String(raw));
    case "bulletLink": return bulletLink(String(raw));
    case "multiConversations": return { type: "multi_conversations_select", selected_conversations: raw as string[] };
    case "conversation": return { type: "conversations_select", selected_conversation: String(raw) };
    case "fileUpload": throw new Error(`buildState: fileUpload field "${field.key}" must resolve via uploadedIds`);
  }
}

export function buildState(
  page: PageDef,
  payload: Record<string, unknown>,
  blockIds: Map<string, string>,
  uploadedIds: Map<string, string>,
  hooks?: Pick<WorkflowDefinition, "formatValue">,
): { values: Record<string, Record<string, unknown>> } {
  const values: Record<string, Record<string, unknown>> = {};
  const put = (actionId: string, value: unknown) => {
    const blockId = blockIds.get(actionId);
    if (!blockId) throw new Error(`buildState: no block_id in view for action_id ${actionId}`);
    values[blockId] = { [actionId]: value };
  };

  for (const field of page.fields) {
    if (field.format === "fileUpload") {
      const id = uploadedIds.get(field.key);
      if (id === undefined) {
        if (field.optional) continue;
        throw new Error(`buildState: no uploaded file id for required field "${field.key}"`);
      }
      put(field.actionId, { type: "file_input", files: [{ id }] });
      continue;
    }
    const raw = payload[field.key];
    if (raw === undefined) {
      if (field.optional) continue;
      throw new Error(`buildState: missing required field "${field.key}"`);
    }
    const value = hooks?.formatValue?.(field, raw) ?? defaultFormat(field, raw);
    put(field.actionId, value);
  }
  return { values };
}
