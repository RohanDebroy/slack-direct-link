import { test, expect } from "bun:test";
import { WorkflowDefinitionSchema, isReactionTrigger } from "../src/workflow/definition.ts";

const base = { name: "w", pages: [{ fields: [{ key: "k", actionId: "A1", format: "plain" }] }] };

test("shortcut trigger parses with kind omitted (back-compat)", () => {
  const r = WorkflowDefinitionSchema.safeParse({
    ...base, trigger: { url: "https://slack/x", context: { location: "slash_command", channel_id: "C1" } },
  });
  expect(r.success).toBe(true);
  if (r.success) expect(isReactionTrigger(r.data.trigger)).toBe(false);
});

test("reaction trigger parses", () => {
  const r = WorkflowDefinitionSchema.safeParse({
    ...base, trigger: { kind: "reaction", emoji: "accessibility", appId: "A092KLW9XXX" },
  });
  expect(r.success).toBe(true);
  if (r.success) expect(isReactionTrigger(r.data.trigger)).toBe(true);
});

test("reaction trigger missing emoji is rejected", () => {
  const r = WorkflowDefinitionSchema.safeParse({
    ...base, trigger: { kind: "reaction", appId: "A1" },
  });
  expect(r.success).toBe(false);
});
