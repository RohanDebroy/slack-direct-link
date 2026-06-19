# Reaction-trigger workflow type — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `slack-cli` fire an emoji-reaction-triggered Slack workflow end-to-end — react to a chosen message, dismiss the bot's "Continue" prompt, fill the modal, and submit — selecting the target thread by message permalink.

**Architecture:** Add a `reaction` trigger kind to the workflow definition (alongside today's `shortcut`). The runner branches on kind: the reaction path calls `reactions.add`, waits for the bot's Continue DM off the WSS stream, dispatches the button via `blocks.actions`, then hands the opened modal to the existing page-fill loop (extracted into a shared `fillPages` helper). New core API wrappers: `reactionsAdd`, `blocksActions`.

**Tech Stack:** TypeScript, Bun (test + dev runtime), Zod (schema validation), esbuild (bundled build), CDP (drives the Slack desktop renderer).

## Global Constraints

- Bun ≥ 1.3 for dev/test; bundled output must run on Node ≥ 18.
- No new runtime dependencies. Only `esbuild`/`typescript`/`@types/bun` exist as dev deps.
- Workflow files in `workflows/` must be **self-contained at runtime**: only *type-only* imports may cross files (the build compiles each with `bundle: false` and does not rewrite import specifiers). Do NOT import runtime values from other workflow files or from `packages/`.
- Match existing code style (zod wrappers per `triggersTrip`, `apiCall` for HTTP, `passthrough()` on Slack response schemas).
- Existing `shortcut` workflows must keep working unchanged (`kind` omitted ⇒ shortcut).
- Tests run with `bun test`. Typecheck with `bun run typecheck`. Build with `bun run build`.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Permalink + message-ref parsing

**Files:**
- Create: `packages/cli/src/workflow/permalink.ts`
- Test: `packages/cli/tests/permalink.test.ts`

**Interfaces:**
- Produces: `parsePermalink(url: string): { channel: string; ts: string }`,
  `resolveMessageRef(payload: Record<string, unknown>): { channel: string; ts: string }`,
  `ParsedMessageRef` (type), `PermalinkParseError` (class).

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/tests/permalink.test.ts
import { test, expect } from "bun:test";
import { parsePermalink, resolveMessageRef, PermalinkParseError } from "../src/workflow/permalink.ts";

test("parsePermalink extracts channel + ts (decimal inserted 6 from end)", () => {
  expect(parsePermalink("https://example.slack.com/archives/C04DHHV7XXX/p1781616382302439"))
    .toEqual({ channel: "C04DHHV7XXX", ts: "1781616382.302439" });
});

test("parsePermalink tolerates a trailing query string", () => {
  expect(parsePermalink("https://x.slack.com/archives/C1/p1700000000000001?thread_ts=1700000000.000001&cid=C1"))
    .toEqual({ channel: "C1", ts: "1700000000.000001" });
});

test("parsePermalink throws on a non-permalink", () => {
  expect(() => parsePermalink("https://slack.com/shortcuts/Ft1/abc")).toThrow(PermalinkParseError);
});

test("resolveMessageRef prefers _message permalink", () => {
  expect(resolveMessageRef({ _message: "https://x.slack.com/archives/C9/p1781616382302439" }))
    .toEqual({ channel: "C9", ts: "1781616382.302439" });
});

test("resolveMessageRef falls back to explicit _channel + _ts", () => {
  expect(resolveMessageRef({ _channel: "C7", _ts: "1781616382.302439" }))
    .toEqual({ channel: "C7", ts: "1781616382.302439" });
});

test("resolveMessageRef throws when neither is present", () => {
  expect(() => resolveMessageRef({ extensionVersion: "8.24.0" })).toThrow(PermalinkParseError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/tests/permalink.test.ts`
Expected: FAIL — `Cannot find module ".../permalink.ts"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/workflow/permalink.ts
export interface ParsedMessageRef {
  channel: string;
  ts: string;
}

export class PermalinkParseError extends Error {}

// Slack "Copy link" URLs look like .../archives/<C...>/p<digits>[?query].
const ARCHIVES_RE = /\/archives\/([A-Z0-9]+)\/p(\d+)/;

/** Parse a Slack message permalink into { channel, ts } (decimal inserted 6 digits from the end). */
export function parsePermalink(url: string): ParsedMessageRef {
  const m = ARCHIVES_RE.exec(url);
  if (!m) throw new PermalinkParseError(`not a Slack message permalink: ${url}`);
  const digits = m[2]!;
  if (digits.length < 7) throw new PermalinkParseError(`malformed message id in permalink: ${url}`);
  return { channel: m[1]!, ts: `${digits.slice(0, -6)}.${digits.slice(-6)}` };
}

/** Resolve the reacted-message ref from a payload: prefer `_message` (permalink), else `_channel`+`_ts`. */
export function resolveMessageRef(payload: Record<string, unknown>): ParsedMessageRef {
  const link = payload._message;
  if (typeof link === "string") return parsePermalink(link);
  const channel = payload._channel;
  const ts = payload._ts;
  if (typeof channel === "string" && typeof ts === "string") return { channel, ts };
  throw new PermalinkParseError('reaction trigger requires "_message" (permalink) or "_channel"+"_ts" in the payload');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/cli/tests/permalink.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/workflow/permalink.ts packages/cli/tests/permalink.test.ts
git commit -m "feat(cli): parse Slack message permalinks into channel + ts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Reaction trigger schema + union-aware consumers

Introduce the `reaction` trigger kind as a discriminated union and update every reader of `def.trigger` (dry-run, loader summary, list output) to be union-aware. This lands as one unit so the build stays green.

**Files:**
- Modify: `packages/cli/src/workflow/definition.ts` (trigger schema/types + `isReactionTrigger`)
- Modify: `packages/cli/src/workflow/runner.ts:42-47` (`resolveContext` guards shortcut-only)
- Modify: `packages/cli/src/workflow/dry-run.ts` (branch on kind)
- Modify: `packages/cli/src/workflow/loader.ts:50-97` (`WorkflowSummary` + `listWorkflows`)
- Modify: `packages/cli/src/commands/list.ts:19-25` (print kind-aware trigger line)
- Modify: `packages/cli/tests/loader.test.ts:64` (`triggerUrl` -> `triggerLabel`)
- Test: `packages/cli/tests/definition.test.ts` (create), `packages/cli/tests/dry-run.test.ts` (create)

**Interfaces:**
- Consumes: `parsePermalink`/`resolveMessageRef` from Task 1.
- Produces: `TriggerDef` (union type), `ReactionTrigger`, `ShortcutTrigger` (types),
  `isReactionTrigger(t: TriggerDef): t is ReactionTrigger`. `WorkflowSummary` gains
  `triggerKind: "shortcut" | "reaction"` and `triggerLabel: string`; `triggerUrl` removed,
  `channelId?: string` now optional.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/tests/definition.test.ts
import { test, expect } from "bun:test";
import { WorkflowDefinitionSchema, isReactionTrigger } from "../src/workflow/definition.ts";

const base = { name: "w", pages: [{ fields: [{ key: "k", actionId: "A1", format: "plain" }] }] };

test("shortcut trigger parses with kind omitted (back-compat)", () => {
  const r = WorkflowDefinitionSchema.safeParse({
    ...base, trigger: { url: "https://slack/x", context: { location: "slash_command", channel_id: "C1" } },
  });
  expect(r.success).toBe(true);
  if (r.success) expect(isReactionTrigger(r.data.trigger)).toBe(false);
});

test("reaction trigger parses", () => {
  const r = WorkflowDefinitionSchema.safeParse({
    ...base, trigger: { kind: "reaction", emoji: "accessibility", appId: "A092KLW9XXX" },
  });
  expect(r.success).toBe(true);
  if (r.success) expect(isReactionTrigger(r.data.trigger)).toBe(true);
});

test("reaction trigger missing emoji is rejected", () => {
  const r = WorkflowDefinitionSchema.safeParse({
    ...base, trigger: { kind: "reaction", appId: "A1" },
  });
  expect(r.success).toBe(false);
});
```

```ts
// packages/cli/tests/dry-run.test.ts
import { test, expect } from "bun:test";
import { printDryRun } from "../src/workflow/dry-run.ts";
import type { WorkflowDefinition } from "../src/workflow/definition.ts";

function capture(fn: () => void): string {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.join(" ")); };
  try { fn(); } finally { console.log = orig; }
  return lines.join("\n");
}

const reactionDef: WorkflowDefinition = {
  name: "r",
  trigger: { kind: "reaction", emoji: "accessibility", appId: "A092KLW9XXX" },
  pages: [{ fields: [{ key: "extensionVersion", actionId: "A1", format: "plain" }] }],
};

test("dry-run prints reaction emoji + parsed target, no Slack calls", () => {
  const out = capture(() => printDryRun(reactionDef, {
    _message: "https://x.slack.com/archives/C04DHHV7XXX/p1781616382302439",
    extensionVersion: "8.24.0",
  }));
  expect(out).toContain("reaction :accessibility:");
  expect(out).toContain("channel=C04DHHV7XXX ts=1781616382.302439");
  expect(out).toContain("extensionVersion [plain] = \"8.24.0\"");
  expect(out).toContain("no Slack calls made");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/tests/definition.test.ts packages/cli/tests/dry-run.test.ts`
Expected: FAIL — `isReactionTrigger` not exported / reaction trigger rejected by current single-shape schema.

- [ ] **Step 3: Write minimal implementation**

In `packages/cli/src/workflow/definition.ts`, replace the `TriggerContextSchema`/`TriggerDefSchema`/`TriggerDef` block (lines 57-61) with:

```ts
export const TriggerContextSchema = z.object({ location: z.string(), channel_id: z.string() });
export type TriggerContext = z.infer<typeof TriggerContextSchema>;

/** Shortcut/link trigger (the original kind). `kind` omitted ⇒ treated as shortcut. */
export const ShortcutTriggerSchema = z.object({
  kind: z.literal("shortcut").optional(),
  url: z.string(),
  context: TriggerContextSchema,
});
export type ShortcutTrigger = z.infer<typeof ShortcutTriggerSchema>;

/** Reaction (event) trigger: react with `emoji`; `appId` identifies the bot's Continue DM. */
export const ReactionTriggerSchema = z.object({
  kind: z.literal("reaction"),
  emoji: z.string().min(1),
  appId: z.string().min(1),
});
export type ReactionTrigger = z.infer<typeof ReactionTriggerSchema>;

// Reaction first: it carries an explicit `kind`; a shortcut object (kind absent) matches the second.
export const TriggerDefSchema = z.union([ReactionTriggerSchema, ShortcutTriggerSchema]);
export type TriggerDef = z.infer<typeof TriggerDefSchema>;

export function isReactionTrigger(t: TriggerDef): t is ReactionTrigger {
  return (t as { kind?: string }).kind === "reaction";
}
```

In `packages/cli/src/workflow/runner.ts`, update `resolveContext` (lines 42-47) to guard against reaction triggers:

```ts
export function resolveContext(def: WorkflowDefinition, payload: Record<string, unknown>): TriggerContext {
  if (isReactionTrigger(def.trigger)) throw new Error("resolveContext: trigger is not a shortcut trigger");
  if (def.buildContext) return def.buildContext(payload);
  const channel = payload._channel;
  if (typeof channel === "string") return { ...def.trigger.context, channel_id: channel };
  return def.trigger.context;
}
```

Add `isReactionTrigger` to the existing import from `./definition.ts` at the top of `runner.ts`.

Replace the body of `packages/cli/src/workflow/dry-run.ts` with:

```ts
import { resolveContext } from "./runner.ts";
import { isReactionTrigger } from "./definition.ts";
import { resolveMessageRef } from "./permalink.ts";
import type { WorkflowDefinition } from "./definition.ts";

/** Print the resolved trigger + per-page field values without calling Slack. */
export function printDryRun(def: WorkflowDefinition, payload: Record<string, unknown>): void {
  console.log(`[dry-run] workflow "${def.name}"`);
  if (isReactionTrigger(def.trigger)) {
    console.log(`[dry-run] trigger: reaction :${def.trigger.emoji}: (app ${def.trigger.appId})`);
    const ref = resolveMessageRef(payload);
    console.log(`[dry-run] target: channel=${ref.channel} ts=${ref.ts}`);
  } else {
    console.log(`[dry-run] trigger url: ${def.trigger.url}`);
    console.log(`[dry-run] context: ${JSON.stringify(resolveContext(def, payload))}`);
  }
  def.pages.forEach((page, p) => {
    console.log(`[dry-run] page ${p}:`);
    for (const f of page.fields) {
      const present = payload[f.key] !== undefined;
      if (!present && f.optional) continue;
      const v = payload[f.key];
      const note = f.format === "fileUpload" ? ` (upload: ${Array.isArray(v) ? v.join(", ") : String(v)})` : "";
      console.log(`[dry-run]   ${f.key} [${f.format}] = ${JSON.stringify(payload[f.key])}${note}`);
    }
  });
  console.log("[dry-run] no Slack calls made");
}
```

In `packages/cli/src/workflow/loader.ts`, replace the `WorkflowSummary` interface (lines 50-61) with:

```ts
export interface WorkflowSummary {
  /** Basename to pass to `trigger <name>` (workflows/<name>.ts). */
  name: string;
  /** The definition's declared `name` (usually equal to the basename). */
  declaredName: string;
  description?: string;
  triggerKind: "shortcut" | "reaction";
  /** Human-readable trigger: the URL for shortcut, `reaction :emoji: (app …)` for reaction. */
  triggerLabel: string;
  /** Shortcut triggers only; absent for reaction triggers. */
  channelId?: string;
  pages: number;
  fields: number;
  fieldKeys: string[];
}
```

In the same file, add the import `isReactionTrigger` from `./definition.ts`, and replace the `workflows.push({...})` block (lines 83-92) with:

```ts
      const reaction = isReactionTrigger(def.trigger);
      workflows.push({
        name,
        declaredName: def.name,
        ...(def.description !== undefined ? { description: def.description } : {}),
        triggerKind: reaction ? "reaction" : "shortcut",
        triggerLabel: reaction
          ? `reaction :${def.trigger.emoji}: (app ${def.trigger.appId})`
          : def.trigger.url,
        ...(reaction ? {} : { channelId: def.trigger.context.channel_id }),
        pages: def.pages.length,
        fields: fieldKeys.length,
        fieldKeys,
      });
```

In `packages/cli/src/commands/list.ts`, replace lines 23-24 with:

```ts
    const chan = w.channelId ? `  channel: ${w.channelId}` : "";
    console.log(`  pages: ${w.pages}  fields: ${w.fields}${chan}`);
    console.log(`  trigger: ${w.triggerLabel}`);
```

In `packages/cli/tests/loader.test.ts`, update line 64 for the rename:

```ts
  expect(good!.triggerLabel).toBe("https://slack/x");
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/cli/tests/definition.test.ts packages/cli/tests/dry-run.test.ts packages/cli/tests/loader.test.ts`
Expected: PASS (definition 3 + dry-run 1 + loader unchanged count, all green).
Run: `bun run typecheck`
Expected: PASS (no type errors across the union narrowing).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/workflow/definition.ts packages/cli/src/workflow/runner.ts \
  packages/cli/src/workflow/dry-run.ts packages/cli/src/workflow/loader.ts \
  packages/cli/src/commands/list.ts packages/cli/tests/loader.test.ts \
  packages/cli/tests/definition.test.ts packages/cli/tests/dry-run.test.ts
git commit -m "feat(cli): add reaction trigger kind to workflow schema + union-aware readers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Core `reactions.add` wrapper

**Files:**
- Create: `packages/core/src/api/reactions.ts`
- Modify: `packages/core/src/index.ts` (export)
- Test: `packages/core/tests/reactions.test.ts`

**Interfaces:**
- Produces: `reactionsAdd(session, { channel, timestamp, name }): Promise<void>`,
  `ReactionsAddInput` (type), `ReactionsAddError` (class).

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/tests/reactions.test.ts
import { test, expect } from "bun:test";
import { reactionsAdd, ReactionsAddError } from "../src/api/reactions.ts";

function fakeSession(result: unknown) {
  return { evaluate: async () => result } as any;
}

test("reactionsAdd resolves on ok:true", async () => {
  await reactionsAdd(fakeSession({ ok: true }), { channel: "C1", timestamp: "1.2", name: "accessibility" });
});

test("reactionsAdd throws ReactionsAddError on ok:false (e.g. already_reacted)", async () => {
  const p = reactionsAdd(fakeSession({ ok: false, error: "already_reacted" }), { channel: "C1", timestamp: "1.2", name: "accessibility" });
  await expect(p).rejects.toBeInstanceOf(ReactionsAddError);
  await expect(p).rejects.toThrow("already_reacted");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/tests/reactions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/api/reactions.ts
import { z } from "zod";
import type { Session } from "../cdp/types.ts";
import { apiCall } from "./client.ts";

const SlackError = z.object({ ok: z.literal(false), error: z.string().optional() }).passthrough();

export class ReactionsAddError extends Error {
  constructor(public slackError: string, public raw: unknown) {
    super(`Slack API reactions.add returned ok:false (error="${slackError}"). Raw response: ${JSON.stringify(raw)}`);
  }
}

export interface ReactionsAddInput {
  channel: string;
  /** Slack message ts, e.g. "1781616382.302439". */
  timestamp: string;
  /** Emoji name without colons, e.g. "accessibility". */
  name: string;
}

export async function reactionsAdd(session: Session, input: ReactionsAddInput): Promise<void> {
  const raw = await apiCall<unknown>(session, "reactions.add", {
    channel: input.channel,
    timestamp: input.timestamp,
    name: input.name,
  });
  const err = SlackError.safeParse(raw);
  if (err.success) throw new ReactionsAddError(err.data.error ?? "unknown", raw);
}
```

Add to `packages/core/src/index.ts` after the `triggersTrip` export (line 3):

```ts
export { reactionsAdd } from "./api/reactions.ts";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/tests/reactions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/api/reactions.ts packages/core/src/index.ts packages/core/tests/reactions.test.ts
git commit -m "feat(core): add reactions.add API wrapper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Core `blocks.actions` wrapper

**Files:**
- Create: `packages/core/src/api/blocks.ts`
- Modify: `packages/core/src/index.ts` (export)
- Test: `packages/core/tests/blocks.test.ts`

**Interfaces:**
- Produces: `blocksActions(session, BlocksActionsInput): Promise<void>`, plus types
  `BlocksActionsContainer`, `BlocksActionsAction`, `BlocksActionsInput`, and `BlocksActionsError`.
  `BlocksActionsInput = { appId, serviceId, serviceTeamId, container, action, state?, client_token? }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/tests/blocks.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/tests/blocks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/api/blocks.ts
import { z } from "zod";
import type { Session } from "../cdp/types.ts";
import { apiCall } from "./client.ts";

const SlackError = z.object({ ok: z.literal(false), error: z.string().optional() }).passthrough();

export class BlocksActionsError extends Error {
  constructor(public slackError: string, public raw: unknown) {
    super(`Slack API blocks.actions returned ok:false (error="${slackError}"). Raw response: ${JSON.stringify(raw)}`);
  }
}

export interface BlocksActionsContainer {
  type: string;
  message_ts: string;
  attachment_id: number;
  channel_id: string;
  is_ephemeral: boolean;
}

export interface BlocksActionsAction {
  action_id: string;
  block_id: string;
  value?: string;
  type: string;
}

export interface BlocksActionsInput {
  appId: string;
  serviceId: string;
  serviceTeamId: string;
  container: BlocksActionsContainer;
  action: BlocksActionsAction;
  state?: { values: Record<string, unknown> };
  client_token?: string;
}

export async function blocksActions(session: Session, input: BlocksActionsInput): Promise<void> {
  const client_token = input.client_token ?? `web-${Date.now()}`;
  const raw = await apiCall<unknown>(session, "blocks.actions", {
    app_id: input.appId,
    service_id: input.serviceId,
    service_team_id: input.serviceTeamId,
    container: JSON.stringify(input.container),
    actions: JSON.stringify([input.action]),
    state: JSON.stringify(input.state ?? { values: {} }),
    client_token,
  });
  const err = SlackError.safeParse(raw);
  if (err.success) throw new BlocksActionsError(err.data.error ?? "unknown", raw);
}
```

Add to `packages/core/src/index.ts` after the `reactionsAdd` export:

```ts
export { blocksActions } from "./api/blocks.ts";
export type { BlocksActionsContainer, BlocksActionsAction, BlocksActionsInput } from "./api/blocks.ts";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/tests/blocks.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/api/blocks.ts packages/core/src/index.ts packages/core/tests/blocks.test.ts
git commit -m "feat(core): add blocks.actions API wrapper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: WSS message event — capture bot DM + Continue button

**Files:**
- Modify: `packages/core/src/wss/events.ts` (extend `Message` schema)
- Test: `packages/core/tests/events.test.ts` (create)

**Interfaces:**
- Produces: parsed `message` events now optionally carry `app_id`, `bot_id`, `team`,
  `subtype`, and `attachments: { id?, blocks?: { block_id?, elements?: { type?, action_id?, value? }[] }[] }[]`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/tests/events.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/tests/events.test.ts`
Expected: FAIL — `app_id`/`attachments` stripped by the current `Message` schema (assertions undefined).

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/wss/events.ts`, replace the `Message` definition (lines 4-10) with:

```ts
const ActionEl = z.object({
  type: z.string().optional(),
  action_id: z.string().optional(),
  value: z.string().optional(),
}).passthrough();

const AttachmentBlock = z.object({
  type: z.string().optional(),
  block_id: z.string().optional(),
  elements: z.array(ActionEl).optional(),
}).passthrough();

const MessageAttachment = z.object({
  id: z.number().optional(),
  blocks: z.array(AttachmentBlock).optional(),
}).passthrough();

const Message = z.object({
  type: z.literal("message"),
  channel: z.string(),
  user: z.string().optional(),
  text: z.string().optional(),
  ts: z.string(),
  subtype: z.string().optional(),
  app_id: z.string().optional(),
  bot_id: z.string().optional(),
  team: z.string().optional(),
  attachments: z.array(MessageAttachment).optional(),
}).passthrough();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/tests/events.test.ts`
Expected: PASS (2 tests).
Run: `bun test packages/core/tests/wss.test.ts`
Expected: PASS (no regression — existing view_opened test unaffected).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/wss/events.ts packages/core/tests/events.test.ts
git commit -m "feat(core): capture app_id + attachment buttons on WSS message events

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Refactor the page-fill loop into a shared `fillPages` helper

Pure refactor — no behavioural change. The existing `runner.test.ts` is the regression guard.

**Files:**
- Modify: `packages/cli/src/workflow/runner.ts` (extract loop body 72-123 into `fillPages`; shortcut path calls it)

**Interfaces:**
- Produces (internal to runner.ts): `fillPages(i: FillPagesInput): Promise<number>` returning `pagesSubmitted`,
  where `FillPagesInput = { def, payload, session, stream, firstView: ViewOpened, readFile, deps, timeout }`.

- [ ] **Step 1: Confirm the regression guard is currently green**

Run: `bun test packages/cli/tests/runner.test.ts`
Expected: PASS (5 tests) — capture this as the baseline.

- [ ] **Step 2: Extract `fillPages` and rewire the shortcut path**

In `packages/cli/src/workflow/runner.ts`, add this helper above `runWorkflow`:

```ts
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
```

Then replace the body of `runWorkflow` (the section from the `client_token` line through the final `return`, lines 53-129) with:

```ts
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
```

(`d`, `readFile`, `timeout` are already declared at the top of `runWorkflow`; keep those lines.)

- [ ] **Step 3: Run the regression guard**

Run: `bun test packages/cli/tests/runner.test.ts`
Expected: PASS (5 tests, unchanged).
Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/workflow/runner.ts
git commit -m "refactor(cli): extract fillPages helper from the runner loop

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Runner reaction path

**Files:**
- Modify: `packages/cli/src/workflow/runner.ts` (deps, branch, `runReactionWorkflow`, `extractContinue`)
- Test: `packages/cli/tests/runner-reaction.test.ts` (create)

**Interfaces:**
- Consumes: `reactionsAdd`, `blocksActions` (Task 3/4), `resolveMessageRef` (Task 1),
  `isReactionTrigger`/`ReactionTrigger` (Task 2), the message-event fields (Task 5), `fillPages` (Task 6).
- Produces: `RunDeps` gains `reactionsAdd` and `blocksActions`; `runWorkflow` branches on
  `isReactionTrigger(def.trigger)`. `RunOutput.functionExecutionId`/`triggerExecutionId` are `""` for the reaction path.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/tests/runner-reaction.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/tests/runner-reaction.test.ts`
Expected: FAIL — `RunDeps` has no `reactionsAdd`/`blocksActions`; reaction trigger falls through to the shortcut path and calls `triggersTrip` (the test's stub throws).

- [ ] **Step 3: Write the implementation**

At the top of `packages/cli/src/workflow/runner.ts`, extend the core imports and types:

```ts
import {
  triggersTrip as _triggersTrip,
  uploadFile as _uploadFile,
  viewsSubmit as _viewsSubmit,
  waitFor as _waitFor,
  reactionsAdd as _reactionsAdd,
  blocksActions as _blocksActions,
} from "@slack-automate/core";
import { resolveMessageRef } from "./permalink.ts";
```

Add the two deps to the `RunDeps` interface and `DEFAULT_DEPS`:

```ts
export interface RunDeps {
  triggersTrip: typeof _triggersTrip;
  uploadFile: typeof _uploadFile;
  viewsSubmit: typeof _viewsSubmit;
  waitFor: typeof _waitFor;
  reactionsAdd: typeof _reactionsAdd;
  blocksActions: typeof _blocksActions;
}
```

```ts
const DEFAULT_DEPS: RunDeps = {
  triggersTrip: _triggersTrip, uploadFile: _uploadFile, viewsSubmit: _viewsSubmit, waitFor: _waitFor,
  reactionsAdd: _reactionsAdd, blocksActions: _blocksActions,
};
```

Ensure `isReactionTrigger` and `ReactionTrigger` are imported from `./definition.ts` (add to the existing import). Add a `SlackMessage` narrowing alias near the `ViewOpened` alias:

```ts
type SlackMessage = Extract<SlackEvent, { type: "message" }>;
```

At the very start of `runWorkflow` body (right after `const { def, payload, session, stream } = input;` — keep the `d`/`readFile`/`timeout` lines above it), add the branch:

```ts
  if (isReactionTrigger(def.trigger)) {
    return runReactionWorkflow(def.trigger, { def, payload, session, stream, readFile, deps: d, timeout });
  }
```

Add the reaction runner and the button extractor below `runWorkflow`:

```ts
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
  let el: { action_id?: string; value?: string } | undefined;
  for (const b of att.blocks ?? []) {
    const button = (b.elements ?? []).find((e) => e.type === "button" && e.action_id);
    if (button) { blockId = b.block_id; el = button; break; }
  }
  if (!blockId || !el?.action_id) throw new Error(`reaction trigger: no Continue button found in the prompt from app ${appId}`);
  return {
    container: { type: "message_attachment", message_ts: msg.ts, attachment_id: att.id ?? 1, channel_id: msg.channel, is_ephemeral: false },
    action: { action_id: el.action_id, block_id: blockId, value: el.value, type: "button" },
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/cli/tests/runner-reaction.test.ts`
Expected: PASS (1 test).
Run: `bun test packages/cli/tests/runner.test.ts`
Expected: PASS (5 tests — shortcut path still works; `makeDeps` in that file lacks `reactionsAdd`/`blocksActions` but the shortcut path never calls them).
Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/workflow/runner.ts packages/cli/tests/runner-reaction.test.ts
git commit -m "feat(cli): drive reaction-triggered workflows end-to-end

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Register the extension-release-via-reaction workflow + end-to-end check

**Files:**
- Create: `workflows/extension-release-via-reaction.ts`
- Test: manual CLI verification (`list`, `trigger --dry-run`) + full suite + build

**Interfaces:**
- Consumes: the reaction trigger schema (Task 2) and reaction runner (Task 7).
- Produces: a loadable workflow named `extension-release-via-reaction`. Self-contained
  (field list duplicated inline from `extension-release-versions.ts` per the build constraint).

- [ ] **Step 1: Create the workflow file (fields duplicated inline, self-contained)**

```ts
// workflows/extension-release-via-reaction.ts
import type { WorkflowDefinition } from "../packages/cli/src/workflow/definition.ts";

// Reaction-triggered twin of extension-release-versions. Reacts with :accessibility: on the
// target message (passed as `_message` permalink in the payload), dismisses the bot's
// "Continue" prompt, then fills the same modal form. Field list is duplicated inline rather
// than imported: workflow files are compiled un-bundled, so cross-file value imports break
// the `bun run build` output. Keep these fields in sync with extension-release-versions.ts.
const def: WorkflowDefinition = {
  name: "extension-release-via-reaction",
  description: "Accessibility extension release via :accessibility: reaction: posts the release into the reacted thread.",
  trigger: { kind: "reaction", emoji: "accessibility", appId: "A092KLW9XXX" },
  pages: [
    {
      fields: [
        { key: "extensionVersion", actionId: "289bff52-71a6-44f9-8062-4d5a024b0f4c", format: "plain" },
        { key: "engineVersion", actionId: "43c596d0-6ce1-4449-b77a-2e172f45738c", format: "plain" },
        { key: "a11yEngineReleaseThread", actionId: "dc0ae4f0-d2bd-4a1b-a63d-613b630ce535", format: "plain", optional: true },
        { key: "a11yExtensionCoreVersion", actionId: "8c44e648-62ad-440c-ade8-0b8be29f92aa", format: "plain", optional: true },
        { key: "jiraLink", actionId: "f2cbee19-6cc2-4f9d-9e2a-0c8f1f719625", format: "richText" },
        { key: "prLink", actionId: "fc6ea757-625e-48bc-b13a-3e23bc1e9136", format: "richText" },
        { key: "changelog", actionId: "8b8d3592-1a87-4988-90e9-336db8fb13b4", format: "richText", autolink: true },
        { key: "whomToTag", actionId: "43f7fb13-e388-40d5-a329-5c4e852c5e89", format: "multiConversations" },
        { key: "notes", actionId: "64ed8fa1-f7a2-49d0-bba9-f7950e735436", format: "richText", optional: true, autolink: true },
        { key: "extensionZips", actionId: "17c5a750-7960-4498-8cef-5f8f7301346b", format: "fileUpload" },
        { key: "reviewedBy", actionId: "e488ec32-7cd2-43e1-b2ea-3915b916c514", format: "conversation" },
      ],
    },
  ],
};

export default def;
```

> NOTE: the modal `action_id`s above are copied from `extension-release-versions.ts` (the same
> form). If the reaction workflow's modal turns out to use different ids at runtime, capture a
> fresh `views.submit`/`views.get` and update them — the field *keys* stay the same.

- [ ] **Step 2: Verify it loads and lists**

Run: `bun packages/cli/bin/slack-cli list`
Expected: output includes:
```
extension-release-via-reaction
  Accessibility extension release via :accessibility: reaction: ...
  pages: 1  fields: 11
  trigger: reaction :accessibility: (app A092KLW9XXX)
```
(no `channel:` line, since reaction triggers have none).

- [ ] **Step 3: Verify dry-run resolves the thread + makes no Slack calls**

Run:
```bash
bun packages/cli/bin/slack-cli trigger extension-release-via-reaction --dry-run --payload '{
  "_message": "https://example.slack.com/archives/C04DHHV7XXX/p1781616382302439",
  "extensionVersion": "8.24.0",
  "engineVersion": "6.4.0",
  "jiraLink": "https://jira/x",
  "prLink": "https://github/x",
  "changelog": "fixed things",
  "whomToTag": ["U1"],
  "extensionZips": "/etc/hosts",
  "reviewedBy": "U2"
}'
```
Expected: prints `trigger: reaction :accessibility: (app A092KLW9XXX)`, `target: channel=C04DHHV7XXX ts=1781616382.302439`, the field values, and `no Slack calls made`. (Using `/etc/hosts` as a stand-in existing file so `fileUpload` validation passes.)

- [ ] **Step 4: Full suite, typecheck, and build**

Run: `bun test`
Expected: PASS (all suites, including the new ones).
Run: `bun run typecheck`
Expected: PASS.
Run: `bun run build`
Expected: succeeds; `dist/workflows/extension-release-via-reaction.mjs` exists and is self-contained.
Run: `SLACK_CLI_WORKFLOWS_DIR=dist/workflows node dist/slack-cli.mjs list`
Expected: lists `extension-release-via-reaction` (confirms the bundled build loads it).

- [ ] **Step 5: Commit**

```bash
git add workflows/extension-release-via-reaction.ts
git commit -m "feat(workflows): add extension-release-via-reaction (reaction-triggered)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **Live verification is manual and has a side effect.** A real run (`trigger extension-release-via-reaction --payload …`, no `--dry-run`) requires Slack running in CDP debug mode (`ensure-debug`) and **adds a visible `:accessibility:` reaction** to the target message. Only do this against a test message/thread. Re-running on the same message fails with `already_reacted` (surfaced by `ReactionsAddError`).
- **README** mentions only shortcut triggers. Updating it to document the reaction kind is reasonable follow-up but out of scope for these tasks.
