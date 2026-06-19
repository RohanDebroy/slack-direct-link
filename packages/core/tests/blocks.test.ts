import { test, expect } from "bun:test";
import { blocksActions, BlocksActionsError } from "../src/api/blocks.ts";

function recordingSession(result: unknown) {
  const calls: { path: string; params: Record<string, string> }[] = [];
  const session = {
    evaluate: async (_expr: string) => result,
  } as any;
  return { session, calls };
}

const input = {
  appId: "A092KLW9XXX",
  serviceId: "B092LVD6XXX",
  serviceTeamId: "T02CSHEXXX",
  container: { type: "message_attachment", message_ts: "1781859144.420109", attachment_id: 1, channel_id: "D093YC6QXXX", is_ephemeral: false },
  action: { action_id: "5fded2cf", block_id: "iESOA", value: "button", type: "button" },
};

test("blocksActions resolves on ok:true", async () => {
  const { session } = recordingSession({ ok: true });
  await blocksActions(session, input);
});

test("blocksActions throws on ok:false", async () => {
  const { session } = recordingSession({ ok: false, error: "action_unknown" });
  await expect(blocksActions(session, input)).rejects.toBeInstanceOf(BlocksActionsError);
});
