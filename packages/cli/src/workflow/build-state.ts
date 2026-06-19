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

const link = (url: string) => ({
  type: "rich_text_input" as const,
  rich_text_value: {
    type: "rich_text",
    elements: [{ type: "rich_text_section", elements: [{ type: "link", url }] }],
  },
});

type RichEl = { type: "text"; text: string } | { type: "link"; url: string };

const URL_RE = /https?:\/\/\S+/g;
const TRAILING_PUNCT = /[.,;:!?]+$/;

/** Split free text into text + link elements, mirroring Slack's paste auto-linkify. */
function linkifyElements(text: string): RichEl[] {
  const out: RichEl[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    let url = m[0];
    const trail = url.match(TRAILING_PUNCT)?.[0] ?? "";
    if (trail) url = url.slice(0, url.length - trail.length);
    if (start > last) out.push({ type: "text", text: text.slice(last, start) });
    out.push({ type: "link", url });
    last = start + url.length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  if (out.length === 0) out.push({ type: "text", text: "" });
  return out;
}

const sectionElements = (text: string, autolink: boolean): RichEl[] =>
  autolink ? linkifyElements(text) : [{ type: "text", text }];

const richText = (text: string, autolink = false) => ({
  type: "rich_text_input" as const,
  rich_text_value: {
    type: "rich_text",
    elements: [{ type: "rich_text_section", elements: sectionElements(text, autolink) }],
  },
});

const bulletText = (text: string, autolink = false) => ({
  type: "rich_text_input" as const,
  rich_text_value: {
    type: "rich_text",
    elements: [{
      type: "rich_text_list", style: "bullet", indent: 0, border: 0,
      elements: [{ type: "rich_text_section", elements: sectionElements(text, autolink) }],
    }],
  },
});

function defaultFormat(field: FieldDef, raw: unknown): unknown {
  switch (field.format) {
    case "plain": return plain(String(raw));
    case "bulletText": return bulletText(String(raw), field.autolink ?? false);
    case "bulletLink": return bulletLink(String(raw));
    case "link": return link(String(raw));
    case "richText": return richText(String(raw), field.autolink ?? false);
    case "multiConversations": return { type: "multi_conversations_select", selected_conversations: raw as string[] };
    case "conversation": return { type: "conversations_select", selected_conversation: String(raw) };
    case "fileUpload": throw new Error(`buildState: fileUpload field "${field.key}" must resolve via uploadedIds`);
    case "checkboxes": throw new Error(`buildState: checkboxes field "${field.key}" must resolve via its options catalog`);
    default: {
      const _exhaustive: never = field.format;
      throw new Error(`buildState: unhandled format "${String(_exhaustive)}"`);
    }
  }
}

export function buildState(
  page: PageDef,
  payload: Record<string, unknown>,
  blockIds: Map<string, string>,
  uploadedIds: Map<string, string[]>,
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
      const ids = uploadedIds.get(field.key);
      if (ids === undefined || ids.length === 0) {
        if (field.optional) continue;
        throw new Error(`buildState: no uploaded file id for required field "${field.key}"`);
      }
      put(field.actionId, { type: "file_input", files: ids.map((id) => ({ id })) });
      continue;
    }
    if (field.format === "checkboxes") {
      const opts = field.options ?? [];
      const want = payload[field.key];
      const selected =
        want === true ? opts
        : Array.isArray(want) ? opts.filter((o) => (want as unknown[]).includes(o.value))
        : [];
      if (selected.length === 0) {
        if (want && opts.length === 0) {
          throw new Error(`buildState: checkboxes field "${field.key}" has no options catalog (re-run extract)`);
        }
        continue; // unchecked -> leave the field out of the submit
      }
      put(field.actionId, { type: "checkboxes", selected_options: selected });
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
