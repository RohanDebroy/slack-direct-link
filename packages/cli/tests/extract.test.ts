import { test, expect } from "bun:test";
import { viewToDefinition, definitionToSource } from "../src/workflow/extract.ts";

const view = {
  title: { text: "Share Extension" },
  blocks: [
    { block_id: "h", type: "header" }, // no element -> skipped
    { block_id: "b1", label: { text: "Extension Version" }, element: { type: "plain_text_input", action_id: "A_ext" } },
    { block_id: "b2", label: { text: "Jira Link" }, element: { type: "rich_text_input", action_id: "A_jira" } },
    { block_id: "b3", label: { text: "Whom To Tag" }, element: { type: "multi_conversations_select", action_id: "A_tag" } },
    { block_id: "b4", label: { text: "Reviewed By" }, element: { type: "conversations_select", action_id: "A_rev" } },
    { block_id: "b5", label: { text: "Attachment" }, element: { type: "file_input", action_id: "A_file" } },
    { block_id: "b6", optional: true, label: { text: "Notes" }, element: { type: "rich_text_input", action_id: "A_notes" } },
    { block_id: "b7", label: { text: "Priority" }, element: { type: "static_select", action_id: "A_prio" } }, // unsupported
    { block_id: "b8", label: { text: "Link" }, element: { type: "plain_text_input", action_id: "A_l1" } },
    { block_id: "b9", label: { text: "Link" }, element: { type: "plain_text_input", action_id: "A_l2" } }, // dup label
  ],
};

const meta = { name: "share-extension-x", url: "https://slack.com/shortcuts/Ft1/abc", channelId: "C123" };

test("viewToDefinition maps element types, labels->keys, optional, and trigger", () => {
  const { definition } = viewToDefinition(view, meta);
  expect(definition.name).toBe("share-extension-x");
  expect(definition.trigger).toEqual({ url: "https://slack.com/shortcuts/Ft1/abc", context: { location: "slash_command", channel_id: "C123" } });
  const fields = definition.pages[0]!.fields;
  // header (no action_id) and static_select (unsupported) are excluded -> 8 fields
  expect(fields.map((f) => f.key)).toEqual([
    "extensionVersion", "jiraLink", "whomToTag", "reviewedBy", "attachment", "notes", "link", "link2",
  ]);
  expect(fields.find((f) => f.key === "extensionVersion")).toEqual({ key: "extensionVersion", actionId: "A_ext", format: "plain" });
  expect(fields.find((f) => f.key === "jiraLink")!.format).toBe("richText");
  expect(fields.find((f) => f.key === "whomToTag")!.format).toBe("multiConversations");
  expect(fields.find((f) => f.key === "reviewedBy")!.format).toBe("conversation");
  expect(fields.find((f) => f.key === "attachment")!.format).toBe("fileUpload");
  expect(fields.find((f) => f.key === "notes")).toEqual({ key: "notes", actionId: "A_notes", format: "richText", optional: true });
});

test("viewToDefinition warns about ambiguous rich_text and skips unsupported types", () => {
  const { warnings } = viewToDefinition(view, meta);
  expect(warnings.some((w) => /jiraLink.*rich_text/i.test(w))).toBe(true);
  expect(warnings.some((w) => /notes.*rich_text/i.test(w))).toBe(true);
  expect(warnings.some((w) => /static_select/.test(w) && /A_prio/.test(w))).toBe(true);
});

test("definitionToSource emits a valid, re-importable module", () => {
  const { definition, warnings } = viewToDefinition(view, meta);
  const src = definitionToSource(definition, warnings);
  expect(src).toContain('import type { WorkflowDefinition }');
  expect(src).toContain('export default def');
  expect(src).toContain('name: "share-extension-x"');
  expect(src).toContain('format: "richText"');
  expect(src).toContain('optional: true');
  // warnings surfaced as comments
  expect(src).toContain("WARNING");
});

test("viewToDefinition maps checkboxes and captures its options catalog", () => {
  const v = {
    blocks: [{
      block_id: "b", optional: true, label: { text: "Checks" },
      element: {
        type: "checkboxes", action_id: "A_c",
        options: [
          { text: { type: "plain_text", text: "Done", emoji: true }, value: "done" },
          { text: { type: "plain_text", text: "Tested", emoji: true }, value: "tested" },
        ],
      },
    }],
  };
  const { definition } = viewToDefinition(v, { name: "x", url: "u", channelId: "C1" });
  const f = definition.pages[0]!.fields[0]!;
  expect(f.format).toBe("checkboxes");
  expect(f.options).toEqual([
    { text: { type: "plain_text", text: "Done", emoji: true }, value: "done" },
    { text: { type: "plain_text", text: "Tested", emoji: true }, value: "tested" },
  ]);
});

test("definitionToSource serializes the checkboxes options catalog", () => {
  const def = {
    name: "x",
    trigger: { url: "u", context: { location: "slash_command", channel_id: "C1" } },
    pages: [{ fields: [{ key: "checks", actionId: "A_c", format: "checkboxes", optional: true, options: [{ text: { type: "plain_text", text: "Done" }, value: "done" }] }] }],
  };
  const src = definitionToSource(def as any, []);
  expect(src).toContain('format: "checkboxes"');
  expect(src).toContain('"value":"done"');
});

test("definitionToSource emits plain ESM (no type import/annotation) when typescript:false", () => {
  const def = {
    name: "x",
    trigger: { url: "u", context: { location: "slash_command", channel_id: "C1" } },
    pages: [{ fields: [{ key: "t", actionId: "A1", format: "plain" }] }],
  };
  const src = definitionToSource(def as any, [], { typescript: false });
  expect(src).not.toContain("import type");
  expect(src).toContain("const def = {");
  expect(src).toContain("export default def");
});

test("viewToDefinition emits a reaction trigger when meta.reaction is set", () => {
  const { definition } = viewToDefinition(view, {
    name: "share-extension-x",
    url: "https://slack.com/shortcuts/Ft1/abc",
    channelId: "C123",
    reaction: { emoji: "accessibility", appId: "A092KLW9XXX" },
  });
  expect(definition.trigger).toEqual({ kind: "reaction", emoji: "accessibility", appId: "A092KLW9XXX" });
  // fields are still captured from the tripped modal, exactly as in shortcut mode
  expect(definition.pages[0]!.fields.find((f) => f.key === "extensionVersion")).toEqual({ key: "extensionVersion", actionId: "A_ext", format: "plain" });
});

test("definitionToSource emits a reaction trigger block (no url/context)", () => {
  const def = {
    name: "x",
    trigger: { kind: "reaction", emoji: "accessibility", appId: "A092KLW9XXX" },
    pages: [{ fields: [{ key: "t", actionId: "A1", format: "plain" }] }],
  };
  const src = definitionToSource(def as any, []);
  expect(src).toContain('kind: "reaction"');
  expect(src).toContain('emoji: "accessibility"');
  expect(src).toContain('appId: "A092KLW9XXX"');
  expect(src).not.toContain("url:");
  expect(src).not.toContain("context:");
});
