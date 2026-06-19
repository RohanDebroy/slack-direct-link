import { test, expect } from "bun:test";
import { printDryRun } from "../src/workflow/dry-run.ts";
import type { WorkflowDefinition } from "../src/workflow/definition.ts";

function capture(fn: () => void): string {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.join(" ")); };
  try { fn(); } finally { console.log = orig; }
  return lines.join("\n");
}

const reactionDef: WorkflowDefinition = {
  name: "r",
  trigger: { kind: "reaction", emoji: "accessibility", appId: "A092KLW9XXX" },
  pages: [{ fields: [{ key: "extensionVersion", actionId: "A1", format: "plain" }] }],
};

test("dry-run prints reaction emoji + parsed target, no Slack calls", () => {
  const out = capture(() => printDryRun(reactionDef, {
    _message: "https://x.slack.com/archives/C04DHHV7XXX/p1781616382302439",
    extensionVersion: "8.24.0",
  }));
  expect(out).toContain("reaction :accessibility:");
  expect(out).toContain("channel=C04DHHV7XXX ts=1781616382.302439");
  expect(out).toContain("extensionVersion [plain] = \"8.24.0\"");
  expect(out).toContain("no Slack calls made");
});
