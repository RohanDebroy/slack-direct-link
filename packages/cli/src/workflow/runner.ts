import { readFile as fsReadFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Session, EventStream, SlackEvent } from "@slack-automate/core";
import {
  triggersTrip as _triggersTrip,
  uploadFile as _uploadFile,
  viewsSubmit as _viewsSubmit,
  waitFor as _waitFor,
} from "@slack-automate/core";
import type { WorkflowDefinition, TriggerContext, ShortcutTrigger } from "./definition.ts";
import { isReactionTrigger } from "./definition.ts";
import { buildState, blockIdMap } from "./build-state.ts";

type ViewOpened = Extract<SlackEvent, { type: "view_opened" }>;

export interface RunDeps {
  triggersTrip: typeof _triggersTrip;
  uploadFile: typeof _uploadFile;
  viewsSubmit: typeof _viewsSubmit;
  waitFor: typeof _waitFor;
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
