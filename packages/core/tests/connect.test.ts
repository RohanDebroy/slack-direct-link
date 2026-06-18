import { test, expect } from "bun:test";
import { findTarget, NoSlackTargetError } from "../src/cdp/connect.ts";

const targets = [
  { url: "chrome://extensions", webSocketDebuggerUrl: "ws://1" },
  { url: "https://app.slack.com/client/E02RTKTNRTL", webSocketDebuggerUrl: "ws://2" },
  { url: "about:blank", webSocketDebuggerUrl: "ws://3" },
];

test("findTarget picks the app.slack.com target", () => {
  const t = findTarget(targets, "app.slack.com");
  expect(t.webSocketDebuggerUrl).toBe("ws://2");
});

test("findTarget throws when no match", () => {
  expect(() => findTarget(targets, "nonexistent")).toThrow(NoSlackTargetError);
});

import { attach } from "../src/cdp/connect.ts";

test("attach throws a friendly error when CDP is unreachable", async () => {
  await expect(attach({ port: 1 })).rejects.toThrow(
    /Couldn't reach Slack on localhost:1. Run `slack-cli launch` first./,
  );
});
