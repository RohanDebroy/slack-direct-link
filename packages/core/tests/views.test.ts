import { test, expect } from "bun:test";
import { viewsGet, viewsSubmit } from "../src/api/views.ts";
import type { Session } from "../src/cdp/types.ts";
import getFixture from "./fixtures/views-get.json";
import submitFixture from "./fixtures/views-submit.json";

const session = (canned: unknown, expectPath: string): Session => ({
  async evaluate<T>(expr: string): Promise<T> {
    expect(expr).toContain(`/api/${expectPath}`);
    return canned as T;
  },
  on: () => () => {},
  close: async () => {},
});

test("viewsGet returns the parsed view", async () => {
  const out = await viewsGet(session(getFixture, "views.get"), "V0B2R4W0G4D");
  expect(out.view.id).toBe("V0B2R4W0G4D");
  expect(out.view.callback_id).toBe("hermes_form");
});

test("viewsSubmit returns response_action: clear", async () => {
  const out = await viewsSubmit(session(submitFixture, "views.submit"), {
    view_id: "V0B2R4W0G4D",
    state: { values: {} },
  });
  expect(out.ok).toBe(true);
  expect(out.response_action).toBe("clear");
});
