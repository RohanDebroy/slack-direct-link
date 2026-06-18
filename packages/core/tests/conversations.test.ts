import { test, expect } from "bun:test";
import { conversationsList } from "../src/api/conversations.ts";
import type { Session } from "../src/cdp/types.ts";

test("conversationsList returns id↔name map entries", async () => {
  const session: Session = {
    async evaluate<T>(expr: string): Promise<T> {
      expect(expr).toContain("/api/conversations.list");
      return {
        ok: true,
        channels: [
          { id: "C1", name: "ch-a11y-eng", is_im: false },
          { id: "C2", name: "ch-general", is_im: false },
          { id: "D1", is_im: true, user: "U1" },
        ],
      } as T;
    },
    on: () => () => {},
    close: async () => {},
  };
  const out = await conversationsList(session);
  expect(out.byName.get("ch-a11y-eng")).toBe("C1");
  expect(out.ims).toContain("D1");
});
