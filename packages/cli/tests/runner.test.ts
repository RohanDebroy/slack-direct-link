import { test, expect } from "bun:test";
import { runWorkflow } from "../src/workflow/runner.ts";
import type { WorkflowDefinition } from "../src/workflow/definition.ts";

function viewEvent(view_id: string, actionIds: string[], client_token?: string) {
  return {
    type: "view_opened" as const,
    view_id,
    ...(client_token ? { client_token } : {}),
    view: { id: view_id, blocks: actionIds.map((a) => ({ block_id: `B_${a}`, element: { action_id: a } })) },
  };
}

// Fake deps that queue views and record submits.
function makeDeps(views: any[], responses: string[]) {
  const submits: any[] = [];
  let viewIdx = 0;
  const deps = {
    triggersTrip: async (_s: any, i: any) => ({
      ok: true, function_execution_id: "FX1", trigger_execution_id: "TR1", client_token: i.client_token,
    }),
    uploadFile: async (_s: any, i: any) => ({ id: `F_${i.filename}`, title: i.filename }),
    viewsSubmit: async (_s: any, i: any) => {
      submits.push(i);
      return { ok: true as const, response_action: responses[submits.length - 1] ?? "" };
    },
    // waitFor returns the next queued view regardless of predicate (predicate tested separately).
    waitFor: async () => views[viewIdx++],
  };
  return { deps, submits };
}

const onePage: WorkflowDefinition = {
  name: "one",
  trigger: { url: "u", context: { location: "slash_command", channel_id: "C1" } },
  pages: [{ fields: [
    { key: "title", actionId: "A1", format: "plain" },
    { key: "attachment", actionId: "A2", format: "fileUpload" },
  ] }],
};

test("single-page workflow: trigger -> view -> upload -> submit", async () => {
  const views = [viewEvent("v1", ["A1", "A2"], "ct")];
  const { deps, submits } = makeDeps(views, [""]);
  const out = await runWorkflow({
    def: onePage,
    payload: { title: "hello", attachment: "/tmp/build.zip" },
    session: {} as any,
    stream: {} as any,
    readFile: async () => new Uint8Array([1, 2, 3]),
    deps: deps as any,
  });
  expect(out.functionExecutionId).toBe("FX1");
  expect(out.pagesSubmitted).toBe(1);
  expect(submits.length).toBe(1);
  expect(submits[0].view_id).toBe("v1");
  // file id linked into the submitted state
  expect(submits[0].state.values["B_A2"]).toEqual({ A2: { type: "file_input", files: [{ id: "F_build.zip" }] } });
  expect(submits[0].state.values["B_A1"]).toEqual({ A1: { type: "plain_text_input", value: "hello" } });
});

const twoPage: WorkflowDefinition = {
  name: "two",
  trigger: { url: "u", context: { location: "slash_command", channel_id: "C1" } },
  pages: [
    { fields: [{ key: "title", actionId: "A1", format: "plain" }] },
    { fields: [{ key: "summary", actionId: "A2", format: "plain" }] },
  ],
};

test("two-page workflow advances on response_action push", async () => {
  const views = [viewEvent("v1", ["A1"], "ct"), viewEvent("v2", ["A2"])];
  const { deps, submits } = makeDeps(views, ["push", ""]);
  const out = await runWorkflow({
    def: twoPage,
    payload: { title: "t", summary: "s" },
    session: {} as any, stream: {} as any,
    readFile: async () => new Uint8Array(),
    deps: deps as any,
  });
  expect(out.pagesSubmitted).toBe(2);
  expect(submits.map((s) => s.view_id)).toEqual(["v1", "v2"]);
  expect(submits[1].state.values["B_A2"]).toEqual({ A2: { type: "plain_text_input", value: "s" } });
});

test("two-page workflow stops early when first submit does not advance", async () => {
  const views = [viewEvent("v1", ["A1"], "ct"), viewEvent("v2", ["A2"])];
  const { deps, submits } = makeDeps(views, ["clear", ""]);
  const out = await runWorkflow({
    def: twoPage,
    payload: { title: "t", summary: "s" },
    session: {} as any, stream: {} as any,
    readFile: async () => new Uint8Array(),
    deps: deps as any,
  });
  expect(out.pagesSubmitted).toBe(1);
  expect(submits.map((s) => s.view_id)).toEqual(["v1"]);
});

test("buildContext hook overrides trigger context", async () => {
  let seenCtx: any;
  const views = [viewEvent("v1", ["A1"], "ct")];
  const deps = {
    triggersTrip: async (_s: any, i: any) => { seenCtx = i.context; return { ok: true, function_execution_id: "FX1", trigger_execution_id: "TR1", client_token: i.client_token }; },
    uploadFile: async () => ({ id: "F", title: "F" }),
    viewsSubmit: async () => ({ ok: true as const, response_action: "" }),
    waitFor: async () => views[0],
  };
  await runWorkflow({
    def: { ...onePage, pages: [{ fields: [{ key: "title", actionId: "A1", format: "plain" }] }], buildContext: (p) => ({ location: "slash_command", channel_id: String(p._channel) }) },
    payload: { title: "t", _channel: "C999" },
    session: {} as any, stream: {} as any,
    readFile: async () => new Uint8Array(),
    deps: deps as any,
  });
  expect(seenCtx).toEqual({ location: "slash_command", channel_id: "C999" });
});
