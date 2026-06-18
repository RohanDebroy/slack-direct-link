import { test, expect } from "bun:test";
import { readJsonObject } from "../src/workflow/json-input.ts";

const flags = { inlineFlag: "--workflow", fileFlag: "--workflow-file" };

test("parses an inline JSON object", () => {
  expect(readJsonObject('{"a":1,"b":"x"}', undefined, flags)).toEqual({ a: 1, b: "x" });
});

test("throws when neither inline nor file is provided", () => {
  expect(() => readJsonObject(undefined, undefined, flags)).toThrow(/exactly one of --workflow or --workflow-file/);
});

test("throws when both inline and file are provided", () => {
  expect(() => readJsonObject("{}", "w.json", flags)).toThrow(/exactly one of/);
});

test("throws on invalid JSON, naming the source flag", () => {
  expect(() => readJsonObject("{bad", undefined, flags)).toThrow(/invalid JSON for --workflow/);
});

test("rejects non-object JSON (array)", () => {
  expect(() => readJsonObject("[1,2]", undefined, flags)).toThrow(/--workflow must be a JSON object/);
});
