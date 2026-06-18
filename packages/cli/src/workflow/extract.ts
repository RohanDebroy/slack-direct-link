import type { WorkflowDefinition, FieldDef, Format } from "./definition.ts";

/** Loose shape of a view_opened modal's input blocks. */
interface ViewInputBlock {
  block_id?: string;
  optional?: boolean;
  label?: { text?: string } | undefined;
  element?: { type?: string; action_id?: string } | undefined;
}

export interface ExtractableView {
  title?: { text?: string } | undefined;
  blocks?: ViewInputBlock[] | undefined;
}

export interface ExtractMeta {
  name: string;
  url: string;
  channelId: string;
  /** Trigger location; matches the Slack web client default for shortcuts. */
  location?: string;
}

export interface ExtractResult {
  definition: WorkflowDefinition;
  warnings: string[];
}

// Slack view element type -> our Format vocabulary. Types absent here are unsupported.
const ELEMENT_FORMAT: Record<string, Format> = {
  plain_text_input: "plain",
  rich_text_input: "richText",
  multi_conversations_select: "multiConversations",
  conversations_select: "conversation",
  file_input: "fileUpload",
};

/** "Extension Version" -> "extensionVersion"; "" -> "". */
function toKey(label: string): string {
  const words = label.replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  return words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join("");
}

/**
 * Turn a single-page view_opened modal into a WorkflowDefinition.
 *
 * Maps each input block's element type to a Format, derives a payload key from the
 * block label, and reads required/optional straight from the view. rich_text_input
 * is reported as ambiguous (the view can't say plain vs bullet vs link) and defaults
 * to richText; unsupported element types are skipped with a warning.
 */
export function viewToDefinition(view: ExtractableView, meta: ExtractMeta): ExtractResult {
  const warnings: string[] = [];
  const fields: FieldDef[] = [];
  const usedKeys = new Set<string>();

  const uniqueKey = (base: string): string => {
    let key = base;
    let n = 1;
    while (usedKeys.has(key)) key = `${base}${++n}`;
    usedKeys.add(key);
    return key;
  };

  for (const block of view.blocks ?? []) {
    const actionId = block.element?.action_id;
    if (!actionId) continue; // not an input block (header/divider/section)

    const type = block.element?.type ?? "";
    const base = toKey(block.label?.text ?? "") || `field${fields.length + 1}`;
    const key = uniqueKey(base);

    const format = ELEMENT_FORMAT[type];
    if (!format) {
      warnings.push(`field "${key}" (action_id ${actionId}): unsupported element type "${type}" — skipped, add it manually`);
      usedKeys.delete(key); // reclaim the key since the field was skipped
      continue;
    }

    const field: FieldDef = block.optional
      ? { key, actionId, format, optional: true }
      : { key, actionId, format };
    fields.push(field);

    if (format === "richText") {
      warnings.push(`field "${key}": rich_text_input is ambiguous (plain/bullet/link) — defaulted to richText; switch to bulletText/bulletLink if needed`);
    }
  }

  const definition: WorkflowDefinition = {
    name: meta.name,
    trigger: { url: meta.url, context: { location: meta.location ?? "slash_command", channel_id: meta.channelId } },
    pages: [{ fields }],
  };
  return { definition, warnings };
}

/** Serialize a single-page WorkflowDefinition into a workflows/<name>.ts module. */
export function definitionToSource(def: WorkflowDefinition, warnings: string[] = []): string {
  const fieldLines = def.pages[0]!.fields.map((f) => {
    const opt = f.optional ? ", optional: true" : "";
    return `        { key: ${JSON.stringify(f.key)}, actionId: ${JSON.stringify(f.actionId)}, format: ${JSON.stringify(f.format)}${opt} },`;
  });

  const warningBlock = warnings.length
    ? warnings.map((w) => `//   WARNING: ${w}`).join("\n") + "\n"
    : "";

  return `import type { WorkflowDefinition } from "../packages/cli/src/workflow/definition.ts";

// Auto-extracted by \`slack-cli extract\`. Review before triggering for real.
${warningBlock}const def: WorkflowDefinition = {
  name: ${JSON.stringify(def.name)},
  trigger: {
    url: ${JSON.stringify(def.trigger.url)},
    context: { location: ${JSON.stringify(def.trigger.context.location)}, channel_id: ${JSON.stringify(def.trigger.context.channel_id)} },
  },
  pages: [
    {
      fields: [
${fieldLines.join("\n")}
      ],
    },
  ],
};

export default def;
`;
}
