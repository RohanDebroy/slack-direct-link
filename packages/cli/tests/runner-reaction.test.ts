import { test, expect } from "bun:test";
import { runWorkflow } from "../src/workflow/runner.ts";
import type { WorkflowDefinition } from "../src/workflow/definition.ts";

const continueMsg = {
  type: "message" as const,
  channel: "D093YC6QXXX",
  ts: "1781859144.420109",
  subtype: "bot_message",
  app_id: "A092KLW9XXX",
  bot_id: "B092LVD6XXX",
  team: "T02CSHEXXX",
  attachments: [{
    id: 1,
    blocks: [{ type: "actions", block_id: "iESOA", elements: [{ type: "button", action_id: "ACT1", value: "button" }] }],
  }],
};

function viewEvent(view_id: string, actionIds: string[]) {
  return { type: "view_opened" as const, view_id, view: { id: view_id, blocks: actionIds.map((a) => ({ block_id: `B_${a}`, element: { action_id: a } })) } };
}

function makeReactionDeps() {
  const calls: any = { reactionsAdd: [], blocksActions: [], submits: [] };
  // waitFor #1 -> Continue message, #2 -> view_opened.
  const queue: any[] = [continueMsg, viewEvent("v1", ["A1"])];
  let idx = 0;
  const deps = {
    triggersTrip: async () => { throw new Error("triggersTrip must not be called on the reaction path"); },
    uploadFile: async (_s: any, i: any) => ({ id: `F_${i.filename}`, title: i.filename }),
    viewsSubmit: async (_s: any, i: any) => { calls.submits.push(i); return { ok: true as const, response_action: "" }; },
    waitFor: async () => queue[idx++],
    reactionsAdd: async (_s: any, i: any) => { calls.reactionsAdd.push(i); },
    blocksActions: async (_s: any, i: any) => { calls.blocksActions.push(i); },
  };
  return { deps, calls };
}

const reactionDef: WorkflowDefinition = {
  name: "react-one",
  trigger: { kind: "reaction", emoji: "accessibility", appId: "A092KLW9XXX" },
  pages: [{ fields: [{ key: "title", actionId: "A1", format: "plain" }] }],
};

test("reaction path: react -> continue -> dispatch -> fill modal", async () => {
  const { deps, calls } = makeReactionDeps();
  const out = await runWorkflow({
    def: reactionDef,
    payload: { _message: "https://x.slack.com/archives/C04DHHV7XXX/p1781616382302439", title: "hello" },
    session: {} as any, stream: {} as any,
    readFile: async () => new Uint8Array(),
    deps: deps as any,
  });

  expect(calls.reactionsAdd[0]).toEqual({ channel: "C04DHHV7XXX", timestamp: "1781616382.302439", name: "accessibility" });
  expect(calls.blocksActions[0].appId).toBe("A092KLW9XXX");
  expect(calls.blocksActions[0].serviceId).toBe("B092LVD6XXX");
  expect(calls.blocksActions[0].serviceTeamId).toBe("T02CSHEXXX");
  expect(calls.blocksActions[0].container).toEqual({ type: "message_attachment", message_ts: "1781859144.420109", attachment_id: 1, channel_id: "D093YC6QXXX", is_ephemeral: false });
  expect(calls.blocksActions[0].action).toEqual({ action_id: "ACT1", block_id: "iESOA", value: "button", type: "button" });
  expect(out.pagesSubmitted).toBe(1);
  expect(calls.submits[0].state.values["B_A1"]).toEqual({ A1: { type: "plain_text_input", value: "hello" } });
});
