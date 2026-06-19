import type { WorkflowDefinition, FieldDef, Format, ShortcutTrigger, TriggerDef } from "./definition.ts";
import { isReactionTrigger } from "./definition.ts";

/** Loose shape of a view_opened modal's input blocks. */
interface ViewInputBlock {
  block_id?: string;
  optional?: boolean;
  label?: { text?: string } | undefined;
  element?: { type?: string; action_id?: string; options?: unknown[] } | undefined;
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
  /**
   * When set, emit a reaction trigger instead of a shortcut trigger. The url is still
   * used only to trip the modal so its fields can be captured; the generated file's
   * trigger becomes { kind: "reaction", emoji, appId }.
   */
  reaction?: { emoji: string; appId: string };
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
  checkboxes: "checkboxes",
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
    if (format === "checkboxes") {
      const opts = (block.element?.options ?? []) as FieldDef["options"];
      if (opts && opts.length) field.options = opts;
      else warnings.push(`field "${key}": checkboxes has no options in the modal — verify the catalog`);
    }
    fields.push(field);

    if (format === "richText") {
      warnings.push(`field "${key}": rich_text_input is ambiguous — defaulted to richText; switch to link, bulletText, or bulletLink if needed`);
    }
  }

  const trigger: TriggerDef = meta.reaction
    ? { kind: "reaction", emoji: meta.reaction.emoji, appId: meta.reaction.appId }
    : { url: meta.url, context: { location: meta.location ?? "slash_command", channel_id: meta.channelId } };
  const definition: WorkflowDefinition = { name: meta.name, trigger, pages: [{ fields }] };
  return { definition, warnings };
}

/** Serialize a single-page WorkflowDefinition into a workflow module (TS, or plain ESM for .mjs). */
export function definitionToSource(
  def: WorkflowDefinition,
  warnings: string[] = [],
  opts: { typescript?: boolean } = {},
): string {
  const typescript = opts.typescript ?? true;
  const fieldLines = def.pages[0]!.fields.map((f) => {
    const parts = [
      `key: ${JSON.stringify(f.key)}`,
      `actionId: ${JSON.stringify(f.actionId)}`,
      `format: ${JSON.stringify(f.format)}`,
    ];
    if (f.optional) parts.push("optional: true");
    if (f.autolink) parts.push("autolink: true");
    if (f.options) parts.push(`options: ${JSON.stringify(f.options)}`);
    return `        { ${parts.join(", ")} },`;
  });

  const warningBlock = warnings.length
    ? warnings.map((w) => `//   WARNING: ${w}`).join("\n") + "\n"
    : "";

  const header = typescript
    ? `import type { WorkflowDefinition } from "../packages/cli/src/workflow/definition.ts";\n\n`
    : "";
  const decl = typescript ? "const def: WorkflowDefinition = {" : "const def = {";

  const triggerBlock = isReactionTrigger(def.trigger)
    ? `  trigger: { kind: "reaction", emoji: ${JSON.stringify(def.trigger.emoji)}, appId: ${JSON.stringify(def.trigger.appId)} },`
    : (() => {
        const s = def.trigger as ShortcutTrigger;
        return `  trigger: {
    url: ${JSON.stringify(s.url)},
    context: { location: ${JSON.stringify(s.context.location)}, channel_id: ${JSON.stringify(s.context.channel_id)} },
  },`;
      })();
  return `${header}// Auto-extracted by \`slack-cli extract\`. Review before triggering for real.
${warningBlock}${decl}
  name: ${JSON.stringify(def.name)},
${triggerBlock}
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
