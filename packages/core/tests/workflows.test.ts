import { test, expect } from "bun:test";
import { triggersTrip } from "../src/api/workflows.ts";
import type { Session } from "../src/cdp/types.ts";
import fixture from "./fixtures/triggers-trip.json";

test("triggersTrip returns parsed execution ids", async () => {
  const session: Session = {
    async evaluate<T>(expr: string): Promise<T> {
      expect(expr).toContain("/api/workflows.triggers.trip");
      expect(expr).toContain(encodeURIComponent("https://slack.com/shortcuts/Ft0B2R4FXXX"));
      return fixture as T;
    },
    on: () => () => {},
    close: async () => {},
  };

  const out = await triggersTrip(session, {
    url: "https://slack.com/shortcuts/Ft0B2R4FXXX/df7425a243d29786e59cb0f897725391",
    context: { location: "slash_command", channel_id: "C09HRTA7XXX" },
  });

  expect(out.ok).toBe(true);
  expect(out.function_execution_id).toBe("Fx0B2WCXA64R");
  expect(out.trigger_execution_id).toBe("Tr0B3NQMRDKJ");
});
