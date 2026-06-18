import { test, expect } from "bun:test";
import { createApiClient } from "../src/api/index.ts";
import type { Session } from "../src/cdp/types.ts";

const fakeSession: Session = {
  // Returns a minimally-valid response shape so any incidental runtime
  // invocation (e.g. through the @ts-expect-error line below) does not reject —
  // the assertion under test is the type-level one.
  evaluate: async () => ({ ok: true, response_action: "clear" }) as never,
  on: () => () => {},
  close: async () => {},
};

test("read-only client exposes read methods at runtime", () => {
  const ro = createApiClient(fakeSession, "r");
  expect(typeof ro.conversationsList).toBe("function");
  expect(typeof ro.viewsGet).toBe("function");
});

test("read-only client write methods are typed `never`", () => {
  const ro = createApiClient(fakeSession, "r");
  // @ts-expect-error — viewsSubmit is `never` on ApiClient<'r'>; calling it must not type-check
  ro.viewsSubmit({ view_id: "V1", state: { values: {} } });
  // The above line is what we're really asserting: the @ts-expect-error directive
  // FAILS to compile if viewsSubmit ever becomes callable on ApiClient<'r'>.
  expect(true).toBe(true);
});

test("read-write client exposes everything", () => {
  const rw = createApiClient(fakeSession, "rw");
  expect(typeof rw.viewsSubmit).toBe("function");
  expect(typeof rw.uploadFile).toBe("function");
});
