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

test("assertValidDefinition rejects an unknown field format (zod enum)", () => {
  const bad = {
    name: "x",
    trigger: { url: "u", context: { location: "slash_command", channel_id: "C1" } },
    pages: [{ fields: [{ key: "k", actionId: "A", format: "bogus" }] }],
  };
  expect(() => assertValidDefinition(bad, "inline")).toThrow(InvalidWorkflowError);
});

import { listWorkflows } from "../src/workflow/loader.ts";

test("listWorkflows summarizes valid workflows and reports invalid ones", async () => {
  const { workflows, errors } = await listWorkflows(FIX);
  // fixtures dir has good-workflow.ts (valid) + bad-workflow.ts (invalid)
  const good = workflows.find((w) => w.name === "good-workflow");
  expect(good).toBeDefined();
  expect(good!.declaredName).toBe("good-workflow");
  expect(good!.pages).toBe(1);
  expect(good!.fields).toBe(1);
  expect(good!.fieldKeys).toEqual(["title"]);
  expect(good!.channelId).toBe("C1");
  expect(good!.triggerUrl).toBe("https://slack/x");
  expect(errors.some((e) => e.file === "bad-workflow.ts")).toBe(true);
});
