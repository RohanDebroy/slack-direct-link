import { test, expect } from "bun:test";
import { validatePayload, PayloadValidationError } from "../src/workflow/validate.ts";
import type { WorkflowDefinition } from "../src/workflow/definition.ts";

const def: WorkflowDefinition = {
  name: "t",
  trigger: { url: "u", context: { location: "slash_command", channel_id: "C1" } },
  pages: [{
    fields: [
      { key: "title", actionId: "A1", format: "plain" },
      { key: "notes", actionId: "A2", format: "bulletText", optional: true },
      { key: "attachment", actionId: "A3", format: "fileUpload" },
    ],
  }],
};

const allExist = () => true;

test("passes when required keys present and file exists", () => {
  expect(() => validatePayload(def, { title: "x", attachment: "./f.zip" }, allExist)).not.toThrow();
});

test("throws on missing required key", () => {
  expect(() => validatePayload(def, { attachment: "./f.zip" }, allExist)).toThrow(PayloadValidationError);
  expect(() => validatePayload(def, { attachment: "./f.zip" }, allExist)).toThrow(/missing required payload key "title"/);
});

test("optional key may be omitted", () => {
  expect(() => validatePayload(def, { title: "x", attachment: "./f.zip" }, allExist)).not.toThrow();
});

test("throws when fileUpload value is not a string path", () => {
  expect(() => validatePayload(def, { title: "x", attachment: 42 }, allExist)).toThrow(/must be a local file path/);
});

test("throws when file does not exist on disk", () => {
  expect(() => validatePayload(def, { title: "x", attachment: "./nope.zip" }, () => false)).toThrow(/file not found/);
});

test("throws on unknown format", () => {
  const bad = { ...def, pages: [{ fields: [{ key: "k", actionId: "A", format: "bogus" as any }] }] };
  expect(() => validatePayload(bad, { k: "v" }, allExist)).toThrow(/unknown format "bogus"/);
});
