import { test, expect } from "bun:test";
import { parseFrame } from "../src/wss/events.ts";
import { waitFor } from "../src/wss/wait-for.ts";
import { createStream } from "../src/wss/stream.ts";
import type { Session, WssFrame } from "../src/cdp/types.ts";

test("parseFrame extracts message events", () => {
  const frame: WssFrame = {
    requestId: "1", timestamp: 0,
    response: {
      payloadData: JSON.stringify({ type: "message", channel: "C1", user: "U1", text: "hi", ts: "1.0" }),
      opcode: 1, mask: false,
    },
  };
  const ev = parseFrame(frame);
  expect(ev?.type).toBe("message");
  if (ev?.type === "message") {
    expect(ev.channel).toBe("C1");
  }
});

test("waitFor resolves on first matching event, rejects on timeout", async () => {
  const handlers: ((p: WssFrame) => void)[] = [];
  const session: Session = {
    evaluate: async () => undefined as never,
    on: (_e, h) => { handlers.push(h); return () => {}; },
    close: async () => {},
  };
  const stream = createStream(session);

  const promise = waitFor(stream, (e) => e.type === "view_opened", { timeout: 1000 });
  // emit a non-matching, then a matching frame
  handlers[0]!({
    requestId: "1", timestamp: 0,
    response: { payloadData: JSON.stringify({ type: "message" }), opcode: 1, mask: false },
  });
  handlers[0]!({
    requestId: "1", timestamp: 0,
    response: {
      payloadData: JSON.stringify({ type: "view_opened", view_id: "V1", client_token: "web-1" }),
      opcode: 1, mask: false,
    },
  });
  const ev = await promise;
  expect(ev.type).toBe("view_opened");
});
