import { readFile as fsReadFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Session, EventStream, SlackEvent } from "@slack-automate/core";
import {
  triggersTrip as _triggersTrip,
  uploadFile as _uploadFile,
  viewsSubmit as _viewsSubmit,
  waitFor as _waitFor,
  reactionsAdd as _reactionsAdd,
  blocksActions as _blocksActions,
} from "@slack-automate/core";
import type { WorkflowDefinition, TriggerContext, ReactionTrigger } from "./definition.ts";
import { isReactionTrigger } from "./definition.ts";
import { resolveMessageRef } from "./permalink.ts";
import { buildState, blockIdMap } from "./build-state.ts";

type ViewOpened = Extract<SlackEvent, { type: "view_opened" }>;
type SlackMessage = Extract<SlackEvent, { type: "message" }>;

export interface RunDeps {
  triggersTrip: typeof _triggersTrip;
  uploadFile: typeof _uploadFile;
  viewsSubmit: typeof _viewsSubmit;
  waitFor: typeof _waitFor;
  reactionsAdd: typeof _reactionsAdd;
  blocksActions: typeof _blocksActions;
}

export interface RunInput {
  def: WorkflowDefinition;
  payload: Record<string, unknown>;
  session: Session;
  stream: EventStream;
  readFile?: (path: string) => Promise<Uint8Array>;
  timeoutMs?: number;
  deps?: RunDeps;
}

export interface RunOutput {
  functionExecutionId: string;
  triggerExecutionId: string;
  pagesSubmitted: number;
}

const DEFAULT_DEPS: RunDeps = {
  triggersTrip: _triggersTrip, uploadFile: _uploadFile, viewsSubmit: _viewsSubmit, waitFor: _waitFor,
  reactionsAdd: _reactionsAdd, blocksActions: _blocksActions,
};

export function resolveContext(def: WorkflowDefinition, payload: Record<string, unknown>): TriggerContext {
  if (isReactionTrigger(def.trigger)) throw new Error("resolveContext: trigger is not a shortcut trigger");
  if (def.buildContext) return def.buildContext(payload);
  const channel = payload._channel;
  if (typeof channel === "string") return { ...def.trigger.context, channel_id: channel };
  return def.trigger.context;
}

interface FillPagesInput {
  def: WorkflowDefinition;
  payload: Record<string, unknown>;
  session: Session;
  stream: EventStream;
  firstView: ViewOpened;
  readFile: (path: string) => Promise<Uint8Array>;
  deps: RunDeps;
  timeout: number;
}

/** Fill and submit each modal page, starting from an already-opened first view. Returns pages submitted. */
async function fillPages(i: FillPagesInput): Promise<number> {
  const { def, payload, session, stream, readFile, deps, timeout } = i;
  let view = i.firstView;
  let pagesSubmitted = 0;
  for (let p = 0; p < def.pages.length; p++) {
    const page = def.pages[p]!;
    const blockIds = blockIdMap(view.view?.blocks);

    const uploadedIds = new Map<string, string[]>();
    for (const field of page.fields) {
      if (field.format !== "fileUpload") continue;
      const val = payload[field.key];
      const paths = typeof val === "string" ? [val] : Array.isArray(val) ? val.filter((p): p is string => typeof p === "string") : [];
      if (paths.length === 0) continue;
      const ids: string[] = [];
      for (const path of paths) {
        const bytes = await readFile(path);
        const uploaded = await deps.uploadFile(session, { bytes, filename: basename(path) });
        ids.push(uploaded.id);
      }
      uploadedIds.set(field.key, ids);
    }

    const state = buildState(page, payload, blockIds, uploadedIds, def);

    const moreToCome = p < def.pages.length - 1;
    const nextPromise: Promise<ViewOpened> | undefined = moreToCome
      ? deps.waitFor(stream, (e: SlackEvent): e is ViewOpened => e.type === "view_opened", { timeout })
      : undefined;

    const resp = await deps.viewsSubmit(session, { view_id: view.view_id, state });
    pagesSubmitted++;

    const advance = def.shouldContinue
      ? def.shouldContinue(resp)
      : resp.response_action === "push" || resp.response_action === "update";

    if (advance && nextPromise) { view = await nextPromise; continue; }
    if (nextPromise) void nextPromise.catch(() => {});
    break;
  }
  return pagesSubmitted;
}

export async function runWorkflow(input: RunInput): Promise<RunOutput> {
  const d = input.deps ?? DEFAULT_DEPS;
  const readFile = input.readFile ?? (async (p: string) => new Uint8Array(await fsReadFile(p)));
  const timeout = input.timeoutMs ?? 15_000;
  const { def, payload, session, stream } = input;

  if (isReactionTrigger(def.trigger)) {
    return runReactionWorkflow(def.trigger, { def, payload, session, stream, readFile, deps: d, timeout });
  }

  const client_token = `web-${Date.now()}`;
  const viewPromise: Promise<ViewOpened> = d.waitFor(
    stream,
    (e: SlackEvent): e is ViewOpened => e.type === "view_opened" && e.client_token === client_token,
    { timeout },
  );

  const trip = await d.triggersTrip(session, {
    url: (def.trigger as { url: string }).url,
    context: resolveContext(def, payload),
    run_precheck: true,
    client_token,
  });

  let firstView: ViewOpened;
  try {
    firstView = await viewPromise;
  } catch (err) {
    throw new Error(`runWorkflow: page 0 view never opened (${(err as Error).message})`);
  }

  const pagesSubmitted = await fillPages({ def, payload, session, stream, firstView, readFile, deps: d, timeout });

  return {
    functionExecutionId: trip.function_execution_id,
    triggerExecutionId: trip.trigger_execution_id,
    pagesSubmitted,
  };
}

interface ReactionRunInput {
  def: WorkflowDefinition;
  payload: Record<string, unknown>;
  session: Session;
  stream: EventStream;
  readFile: (path: string) => Promise<Uint8Array>;
  deps: RunDeps;
  timeout: number;
}

function extractContinue(msg: SlackMessage, appId: string): {
  container: { type: string; message_ts: string; attachment_id: number; channel_id: string; is_ephemeral: boolean };
  action: { action_id: string; block_id: string; value?: string; type: string };
  serviceId: string;
  serviceTeamId: string;
} {
  const att = (msg.attachments ?? [])[0];
  if (!att) throw new Error(`reaction trigger: Continue prompt from app ${appId} had no attachment`);
  let blockId: string | undefined;
  let actionId: string | undefined;
  let value: string | undefined;
  for (const b of att.blocks ?? []) {
    const button = (b.elements ?? []).find((e) => e.type === "button" && e.action_id);
    if (button) { blockId = b.block_id; actionId = button.action_id; value = button.value; break; }
  }
  if (!blockId || !actionId) throw new Error(`reaction trigger: no Continue button found in the prompt from app ${appId}`);
  const action: { action_id: string; block_id: string; value?: string; type: string } =
    value !== undefined
      ? { action_id: actionId, block_id: blockId, value, type: "button" }
      : { action_id: actionId, block_id: blockId, type: "button" };
  return {
    container: { type: "message_attachment", message_ts: msg.ts, attachment_id: att.id ?? 1, channel_id: msg.channel, is_ephemeral: false },
    action,
    serviceId: msg.bot_id ?? "",
    serviceTeamId: msg.team ?? "",
  };
}

async function runReactionWorkflow(trigger: ReactionTrigger, input: ReactionRunInput): Promise<RunOutput> {
  const { def, payload, session, stream, readFile, deps, timeout } = input;
  const { channel, ts } = resolveMessageRef(payload);

  // Subscribe to the bot's Continue DM BEFORE reacting (the WSS frame can precede the HTTP response).
  const msgPromise = deps.waitFor(
    stream,
    (e: SlackEvent): e is SlackMessage => e.type === "message" && e.app_id === trigger.appId,
    { timeout },
  );

  await deps.reactionsAdd(session, { channel, timestamp: ts, name: trigger.emoji });

  let msg: SlackMessage;
  try {
    msg = await msgPromise;
  } catch (err) {
    throw new Error(`reaction trigger: Continue prompt from app ${trigger.appId} never arrived (${(err as Error).message})`);
  }
  const { container, action, serviceId, serviceTeamId } = extractContinue(msg, trigger.appId);

  // Subscribe to the modal BEFORE dispatching the button.
  const viewPromise = deps.waitFor(
    stream,
    (e: SlackEvent): e is ViewOpened => e.type === "view_opened",
    { timeout },
  );

  await deps.blocksActions(session, { appId: trigger.appId, serviceId, serviceTeamId, container, action });

  let firstView: ViewOpened;
  try {
    firstView = await viewPromise;
  } catch (err) {
    throw new Error(`reaction trigger: modal never opened after Continue (${(err as Error).message})`);
  }

  const pagesSubmitted = await fillPages({ def, payload, session, stream, firstView, readFile, deps, timeout });
  return { functionExecutionId: "", triggerExecutionId: "", pagesSubmitted };
}
