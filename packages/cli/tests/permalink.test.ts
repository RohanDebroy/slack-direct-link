import { test, expect } from "bun:test";
import { parsePermalink, resolveMessageRef, PermalinkParseError } from "../src/workflow/permalink.ts";

test("parsePermalink extracts channel + ts (decimal inserted 6 from end)", () => {
  expect(parsePermalink("https://example.slack.com/archives/C04DHHV7XXX/p1781616382302439"))
    .toEqual({ channel: "C04DHHV7XXX", ts: "1781616382.302439" });
});

test("parsePermalink tolerates a trailing query string", () => {
  expect(parsePermalink("https://x.slack.com/archives/C1/p1700000000000001?thread_ts=1700000000.000001&cid=C1"))
    .toEqual({ channel: "C1", ts: "1700000000.000001" });
});

test("parsePermalink throws on a non-permalink", () => {
  expect(() => parsePermalink("https://slack.com/shortcuts/Ft1/abc")).toThrow(PermalinkParseError);
});

test("resolveMessageRef prefers _message permalink", () => {
  expect(resolveMessageRef({ _message: "https://x.slack.com/archives/C9/p1781616382302439" }))
    .toEqual({ channel: "C9", ts: "1781616382.302439" });
});

test("resolveMessageRef falls back to explicit _channel + _ts", () => {
  expect(resolveMessageRef({ _channel: "C7", _ts: "1781616382.302439" }))
    .toEqual({ channel: "C7", ts: "1781616382.302439" });
});

test("resolveMessageRef throws when neither is present", () => {
  expect(() => resolveMessageRef({ extensionVersion: "8.24.0" })).toThrow(PermalinkParseError);
});
