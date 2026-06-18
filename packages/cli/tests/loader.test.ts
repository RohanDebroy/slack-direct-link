import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { loadWorkflow, WorkflowNotFoundError, InvalidWorkflowError } from "../src/workflow/loader.ts";

const FIX = resolve(import.meta.dir, "fixtures");

test("loads a definition by name from a directory", async () => {
  const def = await loadWorkflow("good-workflow", FIX);
  expect(def.name).toBe("good-workflow");
  expect(def.pages[0]!.fields[0]!.key).toBe("title");
});

test("throws WorkflowNotFoundError for unknown name", async () => {
  await expect(loadWorkflow("does-not-exist", FIX)).rejects.toBeInstanceOf(WorkflowNotFoundError);
});

test("throws InvalidWorkflowError for malformed definition", async () => {
  await expect(loadWorkflow("bad-workflow", FIX)).rejects.toBeInstanceOf(InvalidWorkflowError);
});

test("loads the real share-extension-v2 workflow", async () => {
  const def = await loadWorkflow("share-extension-v2");
  expect(def.name).toBe("share-extension-v2");
  expect(def.pages.length).toBeGreaterThan(0);
  expect(def.pages[0]!.fields.some((f) => f.format === "fileUpload")).toBe(true);
});

import { assertValidDefinition } from "../src/workflow/loader.ts";

test("assertValidDefinition rejects a malformed inline definition", () => {
  expect(() => assertValidDefinition({ name: "x", trigger: { url: "u" } }, "inline")).toThrow(InvalidWorkflowError);
});

test("assertValidDefinition accepts a well-formed inline definition", () => {
  const good = {
    name: "x",
    trigger: { url: "u", context: { location: "slash_command", channel_id: "C1" } },
    pages: [{ fields: [{ key: "k", actionId: "A", format: "plain" }] }],
  };
  expect(() => assertValidDefinition(good, "inline")).not.toThrow();
});
