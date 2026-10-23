import { test, expect } from "bun:test";
import { frameLine } from "../src/commands/probe.ts";

const frame = (payloadData: string, opcode = 1) => ({
  requestId: "42.7",
  timestamp: 123.456,
  response: { payloadData, opcode, mask: false },
});

test("frameLine emits one JSON line carrying the exact, untruncated payload", () => {
  const payload = JSON.stringify({ type: "message", text: "x".repeat(200_000) });
  const line = frameLine("recv", frame(payload), 1700000000000);
  expect(line.endsWith("\n")).toBe(true);
  expect(line.slice(0, -1).includes("\n")).toBe(false);
  expect(JSON.parse(line)).toEqual({ time: 1700000000000, dir: "recv", requestId: "42.7", opcode: 1, payload });
});

test("frameLine keeps payloads with raw newlines on a single line, losslessly", () => {
  const payload = '{"a":1}\n{"b":2}';
  const line = frameLine("sent", frame(payload), 1);
  expect(line.slice(0, -1).includes("\n")).toBe(false);
  expect(JSON.parse(line).payload).toBe(payload);
  expect(JSON.parse(line).dir).toBe("sent");
});

test("frameLine passes binary frames through as-is with their opcode", () => {
  const line = frameLine("recv", frame("AAEC", 2), 1);
  expect(JSON.parse(line)).toMatchObject({ opcode: 2, payload: "AAEC" });
});
