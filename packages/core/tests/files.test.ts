import { test, expect } from "bun:test";
import { uploadFile } from "../src/api/files.ts";
import type { Session } from "../src/cdp/types.ts";
import getFixture from "./fixtures/files-getuploadurl.json";
import completeFixture from "./fixtures/files-completeupload.json";

test("uploadFile orchestrates the three-call sequence", async () => {
  const calls: string[] = [];
  const session: Session = {
    async evaluate<T>(expr: string): Promise<T> {
      if (expr.includes("/api/files.getUploadURL")) {
        calls.push("getUploadURL");
        expect(expr).toContain(encodeURIComponent("test.zip"));
        return getFixture as T;
      }
      if (expr.includes("__sa_upload(")) {
        calls.push("upload");
        return { ok: true } as T;
      }
      if (expr.includes("/api/files.completeUpload")) {
        calls.push("completeUpload");
        expect(expr).toContain("F0B2SEM0DSS");
        return completeFixture as T;
      }
      throw new Error(`unexpected expression: ${expr.slice(0, 80)}`);
    },
    on: () => () => {},
    close: async () => {},
  };

  const out = await uploadFile(session, {
    bytes: new Uint8Array([1, 2, 3]),
    filename: "test.zip",
    title: "test.zip",
  });

  expect(out.id).toBe("F0B2SEM0DSS");
  expect(calls).toEqual(["getUploadURL", "upload", "completeUpload"]);
});
