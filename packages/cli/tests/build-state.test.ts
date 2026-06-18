import { test, expect } from "bun:test";
import { blockIdMap, buildState } from "../src/workflow/build-state.ts";
import type { PageDef } from "../src/workflow/definition.ts";

const page: PageDef = {
  fields: [
    { key: "extensionVersion", actionId: "A_ext", format: "plain" },
    { key: "jiraLink", actionId: "A_jira", format: "bulletLink" },
    { key: "changelog", actionId: "A_chg", format: "bulletText" },
    { key: "whomToTag", actionId: "A_tag", format: "multiConversations" },
    { key: "reviewedBy", actionId: "A_rev", format: "conversation" },
    { key: "notes", actionId: "A_notes", format: "bulletText", optional: true },
    { key: "attachment", actionId: "A_file", format: "fileUpload" },
  ],
};

const blocks = [
  { block_id: "B_ext", element: { action_id: "A_ext" } },
  { block_id: "B_jira", element: { action_id: "A_jira" } },
  { block_id: "B_chg", element: { action_id: "A_chg" } },
  { block_id: "B_tag", element: { action_id: "A_tag" } },
  { block_id: "B_rev", element: { action_id: "A_rev" } },
  { block_id: "B_file", element: { action_id: "A_file" } },
];

test("blockIdMap maps action_id -> block_id", () => {
  const m = blockIdMap(blocks);
  expect(m.get("A_ext")).toBe("B_ext");
  expect(m.size).toBe(6);
});

test("buildState formats each field and links the uploaded file id", () => {
  const blockIds = blockIdMap(blocks);
  const uploaded = new Map([["attachment", "F123"]]);
  const { values } = buildState(
    page,
    { extensionVersion: "1.2.3", jiraLink: "https://j", changelog: "did stuff", whomToTag: ["U1", "U2"], reviewedBy: "U9" },
    blockIds,
    uploaded,
  );
  expect(values["B_ext"]).toEqual({ A_ext: { type: "plain_text_input", value: "1.2.3" } });
  expect(values["B_tag"]).toEqual({ A_tag: { type: "multi_conversations_select", selected_conversations: ["U1", "U2"] } });
  expect(values["B_rev"]).toEqual({ A_rev: { type: "conversations_select", selected_conversation: "U9" } });
  expect(values["B_file"]).toEqual({ A_file: { type: "file_input", files: [{ id: "F123" }] } });
  // optional 'notes' omitted from payload -> absent
  expect(values["B_notes"]).toBeUndefined();
  // bulletLink shape
  expect((values["B_jira"]!.A_jira as any).type).toBe("rich_text_input");
});

test("buildState throws when a required field's payload value is missing", () => {
  const blockIds = blockIdMap(blocks);
  expect(() =>
    buildState(page, { jiraLink: "https://j", changelog: "c", whomToTag: ["U1"], reviewedBy: "U9" }, blockIds, new Map([["attachment", "F1"]])),
  ).toThrow(/missing required field "extensionVersion"/);
});

test("buildState throws when the view lacks a needed action_id", () => {
  const blockIds = blockIdMap(blocks.filter((b) => b.element.action_id !== "A_ext"));
  expect(() =>
    buildState(page, { extensionVersion: "1.2.3", jiraLink: "https://j", changelog: "c", whomToTag: ["U1"], reviewedBy: "U9" }, blockIds, new Map([["attachment", "F1"]])),
  ).toThrow(/no block_id in view for action_id A_ext/);
});

test("formatValue hook overrides the default formatter", () => {
  const blockIds = blockIdMap(blocks);
  const { values } = buildState(
    { fields: [{ key: "extensionVersion", actionId: "A_ext", format: "plain" }] },
    { extensionVersion: "1.2.3" },
    blockIds,
    new Map(),
    { formatValue: (f, raw) => ({ type: "custom", k: f.key, v: raw }) },
  );
  expect(values["B_ext"]).toEqual({ A_ext: { type: "custom", k: "extensionVersion", v: "1.2.3" } });
});

test("richText formats a value as a plain rich_text_input section (no bullet)", () => {
  const blockIds = blockIdMap([{ block_id: "B_jira", element: { action_id: "A_jira" } }]);
  const { values } = buildState(
    { fields: [{ key: "jiraLink", actionId: "A_jira", format: "richText" }] },
    { jiraLink: "https://jira/X-1" },
    blockIds,
    new Map(),
  );
  expect(values["B_jira"]).toEqual({
    A_jira: {
      type: "rich_text_input",
      rich_text_value: {
        type: "rich_text",
        elements: [{ type: "rich_text_section", elements: [{ type: "text", text: "https://jira/X-1" }] }],
      },
    },
  });
});

test("link formats a URL as a highlighted (clickable) rich_text link element", () => {
  const blockIds = blockIdMap([{ block_id: "B_j", element: { action_id: "A_j" } }]);
  const { values } = buildState(
    { fields: [{ key: "jiraLink", actionId: "A_j", format: "link" }] },
    { jiraLink: "https://jira/X-1" },
    blockIds,
    new Map(),
  );
  expect(values["B_j"]).toEqual({
    A_j: {
      type: "rich_text_input",
      rich_text_value: {
        type: "rich_text",
        elements: [{ type: "rich_text_section", elements: [{ type: "link", url: "https://jira/X-1" }] }],
      },
    },
  });
});

test("autolink on richText splits URLs into link elements (Slack paste behavior)", () => {
  const blockIds = blockIdMap([{ block_id: "B_n", element: { action_id: "A_n" } }]);
  const { values } = buildState(
    { fields: [{ key: "notes", actionId: "A_n", format: "richText", autolink: true }] },
    { notes: "see https://x.com here" },
    blockIds,
    new Map(),
  );
  expect(values["B_n"]).toEqual({
    A_n: {
      type: "rich_text_input",
      rich_text_value: {
        type: "rich_text",
        elements: [{
          type: "rich_text_section",
          elements: [
            { type: "text", text: "see " },
            { type: "link", url: "https://x.com" },
            { type: "text", text: " here" },
          ],
        }],
      },
    },
  });
});

test("autolink trims trailing punctuation out of the URL", () => {
  const blockIds = blockIdMap([{ block_id: "B_n", element: { action_id: "A_n" } }]);
  const { values } = buildState(
    { fields: [{ key: "notes", actionId: "A_n", format: "richText", autolink: true }] },
    { notes: "done https://x.com/y." },
    blockIds,
    new Map(),
  );
  const els = (values["B_n"]!.A_n as any).rich_text_value.elements[0].elements;
  expect(els).toEqual([
    { type: "text", text: "done " },
    { type: "link", url: "https://x.com/y" },
    { type: "text", text: "." },
  ]);
});

test("autolink on bulletText linkifies inside the bullet", () => {
  const blockIds = blockIdMap([{ block_id: "B_c", element: { action_id: "A_c" } }]);
  const { values } = buildState(
    { fields: [{ key: "changelog", actionId: "A_c", format: "bulletText", autolink: true }] },
    { changelog: "fix https://a.b/1" },
    blockIds,
    new Map(),
  );
  const list = (values["B_c"]!.A_c as any).rich_text_value.elements[0];
  expect(list.type).toBe("rich_text_list");
  expect(list.elements[0].elements).toEqual([
    { type: "text", text: "fix " },
    { type: "link", url: "https://a.b/1" },
  ]);
});

test("autolink with no URL yields a single text element (unchanged shape)", () => {
  const blockIds = blockIdMap([{ block_id: "B_n", element: { action_id: "A_n" } }]);
  const { values } = buildState(
    { fields: [{ key: "notes", actionId: "A_n", format: "richText", autolink: true }] },
    { notes: "plain note" },
    blockIds,
    new Map(),
  );
  const els = (values["B_n"]!.A_n as any).rich_text_value.elements[0].elements;
  expect(els).toEqual([{ type: "text", text: "plain note" }]);
});

const checkboxOpts = [
  { text: { type: "plain_text", text: "Done", emoji: true }, value: "done" },
  { text: { type: "plain_text", text: "Tested", emoji: true }, value: "tested" },
];
const checkboxPage = { fields: [{ key: "checks", actionId: "A_c", format: "checkboxes" as const, options: checkboxOpts }] };
const checkboxBlocks = blockIdMap([{ block_id: "B_c", element: { action_id: "A_c" } }]);

test("checkboxes: payload true selects all options", () => {
  const { values } = buildState(checkboxPage, { checks: true }, checkboxBlocks, new Map());
  expect(values["B_c"]).toEqual({ A_c: { type: "checkboxes", selected_options: checkboxOpts } });
});

test("checkboxes: payload array selects the matching options by value", () => {
  const { values } = buildState(checkboxPage, { checks: ["tested"] }, checkboxBlocks, new Map());
  expect(values["B_c"]).toEqual({ A_c: { type: "checkboxes", selected_options: [checkboxOpts[1]] } });
});

test("checkboxes: omitted or false is left unchecked (field absent from submit)", () => {
  expect(buildState(checkboxPage, {}, checkboxBlocks, new Map()).values["B_c"]).toBeUndefined();
  expect(buildState(checkboxPage, { checks: false }, checkboxBlocks, new Map()).values["B_c"]).toBeUndefined();
});

test("checkboxes: truthy payload with no options catalog throws (needs re-extract)", () => {
  const page = { fields: [{ key: "checks", actionId: "A_c", format: "checkboxes" as const }] };
  expect(() => buildState(page, { checks: true }, checkboxBlocks, new Map())).toThrow(/options catalog/);
});
