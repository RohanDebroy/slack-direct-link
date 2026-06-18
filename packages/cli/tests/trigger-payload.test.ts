import { test, expect } from "bun:test";
import { parsePayload } from "../src/commands/trigger.ts";

test("parses inline JSON payload", () => {
  expect(parsePayload({ payload: '{"a":1,"b":"x"}' })).toEqual({ a: 1, b: "x" });
});

test("throws when neither --payload nor --payload-file given", () => {
  expect(() => parsePayload({})).toThrow(/exactly one of --payload or --payload-file/);
});

test("throws when both given", () => {
  expect(() => parsePayload({ payload: "{}", payloadFile: "p.json" })).toThrow(/exactly one of/);
});

test("throws on invalid JSON", () => {
  expect(() => parsePayload({ payload: "{not json" })).toThrow(/invalid JSON/);
});

test("throws when payload is not a JSON object", () => {
  expect(() => parsePayload({ payload: "[1,2,3]" })).toThrow(/must be a JSON object/);
});
