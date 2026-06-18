import { test, expect } from "bun:test";
import CDP from "chrome-remote-interface";

test.skipIf(!process.env.SLACK_DEBUG_PORT)(
  "chrome-remote-interface connects to a running CDP target",
  async () => {
    const port = Number(process.env.SLACK_DEBUG_PORT ?? 9222);
    const targets = await CDP.List({ port });
    expect(Array.isArray(targets)).toBe(true);

    const client = await CDP({ port, target: targets[0] });
    try {
      const result = await client.Runtime.evaluate({ expression: "1 + 1" });
      expect(result.result.value).toBe(2);
    } finally {
      await client.close();
    }
  },
);
