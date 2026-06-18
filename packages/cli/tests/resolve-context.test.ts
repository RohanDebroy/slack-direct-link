import { test, expect } from "bun:test";
import { resolveContext } from "../src/workflow/runner.ts";
import type { WorkflowDefinition, TriggerContext } from "../src/workflow/definition.ts";

function makeMinimalDef(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    name: "test",
    trigger: {
      url: "https://example.com/trigger",
      context: { location: "loc", channel_id: "C_DEFAULT" },
    },
    pages: [],
    ...overrides,
  };
}

test("resolveContext: buildContext takes precedence when present", () => {
  const expected: TriggerContext = { location: "loc", channel_id: "C_BUILT" };
  const def = makeMinimalDef({ buildContext: () => expected });
  const result = resolveContext(def, { _channel: "C_PAYLOAD" });
  expect(result).toEqual(expected);
});

test("resolveContext: payload._channel overrides def.trigger.context.channel_id when no buildContext", () => {
  const def = makeMinimalDef();
  const result = resolveContext(def, { _channel: "C_OVERRIDE" });
  expect(result).toEqual({ location: "loc", channel_id: "C_OVERRIDE" });
});

test("resolveContext: falls back to def.trigger.context when neither buildContext nor _channel present", () => {
  const def = makeMinimalDef();
  const result = resolveContext(def, {});
  expect(result).toEqual({ location: "loc", channel_id: "C_DEFAULT" });
});
