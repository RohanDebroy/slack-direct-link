import { test, expect } from "bun:test";
import { reactionsAdd, ReactionsAddError } from "../src/api/reactions.ts";

function fakeSession(result: unknown) {
  return { evaluate: async () => result } as any;
}

test("reactionsAdd resolves on ok:true", async () => {
  await reactionsAdd(fakeSession({ ok: true }), { channel: "C1", timestamp: "1.2", name: "accessibility" });
});

test("reactionsAdd throws ReactionsAddError on ok:false (e.g. already_reacted)", async () => {
  const p = reactionsAdd(fakeSession({ ok: false, error: "already_reacted" }), { channel: "C1", timestamp: "1.2", name: "accessibility" });
  await expect(p).rejects.toBeInstanceOf(ReactionsAddError);
  await expect(p).rejects.toThrow("already_reacted");
});
