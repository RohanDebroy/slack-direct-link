import { test, expect } from "bun:test";
import { apiCall } from "../src/api/client.ts";
import type { Session } from "../src/cdp/types.ts";

function fakeSession(canned: unknown): Session {
  return {
    async evaluate<T>(expression: string): Promise<T> {
      // assert the expression looks like an in-renderer fetch
      expect(expression).toContain("fetch(");
      expect(expression).toContain("/api/views.get");
      return canned as T;
    },
    on: () => () => {},
    close: async () => {},
  };
}

test("apiCall builds a form-encoded body and returns parsed JSON", async () => {
  const session = fakeSession({ ok: true, view: { id: "V1" } });
  const out = await apiCall<{ ok: boolean; view: { id: string } }>(
    session,
    "views.get",
    { view_id: "V1" },
  );
  expect(out.ok).toBe(true);
  expect(out.view.id).toBe("V1");
});
