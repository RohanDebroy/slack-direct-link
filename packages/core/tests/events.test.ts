import { test, expect } from "bun:test";
import { parseFrame } from "../src/wss/events.ts";

function frame(obj: unknown) {
  return { response: { opcode: 1, payloadData: JSON.stringify(obj) } } as any;
}

test("parseFrame keeps a bot message's app_id and Continue button (attachment block)", () => {
  const ev = parseFrame(frame({
    type: "message",
    channel: "D093YC6QXXX",
    ts: "1781859144.420109",
    subtype: "bot_message",
    app_id: "A092KLW9XXX",
    bot_id: "B092LVD6XXX",
    team: "T02CSHEXXX",
    attachments: [{
      id: 1,
      blocks: [{ type: "actions", block_id: "iESOA", elements: [{ type: "button", action_id: "5fded2cf", value: "button" }] }],
    }],
  }));
  expect(ev?.type).toBe("message");
  if (ev?.type === "message") {
    expect(ev.app_id).toBe("A092KLW9XXX");
    expect(ev.bot_id).toBe("B092LVD6XXX");
    expect(ev.team).toBe("T02CSHEXXX");
    expect(ev.attachments?.[0]?.id).toBe(1);
    expect(ev.attachments?.[0]?.blocks?.[0]?.block_id).toBe("iESOA");
    expect(ev.attachments?.[0]?.blocks?.[0]?.elements?.[0]?.action_id).toBe("5fded2cf");
  }
});

test("parseFrame still parses a plain user message", () => {
  const ev = parseFrame(frame({ type: "message", channel: "C1", ts: "1.2", text: "hi" }));
  expect(ev?.type).toBe("message");
});
