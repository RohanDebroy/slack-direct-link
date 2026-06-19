# Reaction-trigger workflow type — design

## Problem

`slack-cli` today drives **shortcut-URL** workflows: it trips a `workflows.triggers.trip`
URL, catches the resulting `view_opened` modal, fills it, and submits.

One real workflow ("Extension share via reaction", app `A092KLW9XXX`) is triggered
differently — by an **emoji reaction** (`:accessibility:`) on a message. Slack populates the
workflow's inputs (channel + message ts) from the reaction event, then DMs the user a
**"Continue" button**; clicking it opens the same modal form, which on submit posts a reply
**in the thread of the reacted message**.

We want to drive this end-to-end from the CLI: pick a target thread, fire the workflow
without manually clicking the emoji, and fill + submit the modal — no manual steps.

### Why not "just trigger and pass channel+ts"?

A reaction trigger is a Slack **event trigger**. Its inputs are not open parameters — Slack
*derives* them from the real `reaction_added` event. There is no `triggers.trip` entry point
for an event trigger. The only way to supply "this channel + this message" is to make a
reaction event exist on that message. So `reactions.add(channel, ts, name)` **is** the
mechanism for passing the thread context; the target thread is whichever message we react to.

## Key finding

The modal this reaction workflow opens is the **same form** as the existing
`workflows/extension-release-versions.ts`. The action IDs captured in the HAR's `views.submit`
(`289bff52-...` extensionVersion, `43c596d0-...` engineVersion, `f2cbee19-...` jiraLink) match
that file exactly. So the new workflow **reuses the existing field/page definitions**; only the
trigger and the Continue-button step are new.

## Captured mechanism (from HAR `3-.har`)

1. `reactions.add` — `channel`, `timestamp`, `name=accessibility` -> fires the workflow.
2. Bot (`app_id=A092KLW9XXX`, `bot_id=B092LVD6XXX`) posts a **DM** to the user
   (channel `D...`) containing a **"Continue" button** inside a message **attachment**
   (`attachment_id:1`). Message is a real (non-ephemeral) `bot_message`.
3. `blocks.actions` — dispatch of that button. Request carries:
   - `app_id` (`A092KLW9XXX`), `service_id` (`B092LVD6XXX` = bot_id),
     `service_team_id` (`T02...` = team)
   - `container` = `{ type:"message_attachment", message_ts, attachment_id, channel_id, is_ephemeral:false }`
   - `actions` = `[{ action_id, block_id, value:"button", type:"button", ... }]`
   - `state` = `{ values:{} }`, `client_token`
   Response: `{ ok:true }`.
4. `view_opened` (over WSS) -> modal.
5. File upload (`files.getUploadURL`/`files.completeUpload`) + `views.submit` -> posts the reply
   into the reacted thread.

Steps 4-5 are exactly what the current runner already does.

## Design

### 1. Definition schema — trigger "kind" (`packages/cli/src/workflow/definition.ts`)

Make `trigger` a discriminated union, defaulting to today's behavior for back-compat:

- `{ kind?: "shortcut", url, context }` — existing. `kind` omitted => treated as `shortcut`,
  so all current definitions keep working unchanged.
- `{ kind: "reaction", emoji, appId }` — **new.**
  - `emoji` — reaction name to add (e.g. `accessibility`).
  - `appId` — the workflow bot's app id (`A092KLW9XXX`), used to recognise its Continue DM.

`pages` are unchanged. The `WorkflowDefinition` hooks (`formatValue`, `shouldContinue`) are
unchanged. `buildContext` is shortcut-only and ignored for reaction triggers.

### 2. New core API calls (`packages/core/src/api/`)

- `reactions.ts`: `reactionsAdd(session, { channel, timestamp, name })` -> `reactions.add`.
  Surfaces Slack `ok:false` (notably `already_reacted`) as a typed error.
- `blocks.ts`: `blocksActions(session, { appId, serviceId, serviceTeamId, container, action, state, client_token })`
  -> `blocks.actions`. `state` defaults to `{ values:{} }`.

Both follow the existing `triggersTrip` wrapper pattern (zod-validated, `apiCall`).
Exported from `packages/core/src/api/index.ts` and the package root.

### 3. WSS event — capture the Continue DM (`packages/core/src/wss/events.ts`)

Extend the `Message` event schema to optionally carry the fields needed to recognise and
dispatch the Continue button:

- `app_id?`, `bot_id?`, `subtype?`, `team?`
- `attachments?` — each `{ id, blocks?, actions? }` where a button block exposes
  `action_id`, `block_id`, `value`, `type`.

The runner identifies the Continue DM by `app_id === def.trigger.appId` arriving after the
reaction, and extracts container + action data directly from the frame. **Fallback:** if a
frame lacks attachment detail, fetch the message via `conversations.history` on that channel.

### 4. Permalink parsing (`packages/cli/src/workflow/permalink.ts`)

`parsePermalink(url)` -> `{ channel, ts }` from `.../archives/<C...>/p<digits>`:
ts = digits with a decimal inserted 6 places from the end
(`p1781616382302439` -> `1781616382.302439`). Throws a clear error on malformed input.

Payload key: **`_message`** holds the permalink. Fallback: explicit `_channel` + `_ts`
(used when `_message` is absent). Mirrors the existing `_channel` override convention.

### 5. Runner — reaction path (`packages/cli/src/workflow/runner.ts`)

Refactor the existing page-fill `for`-loop (lines ~72-123) into a shared helper
`fillPages({ def, payload, session, stream, firstView, readFile, deps, timeout })` that both
trigger kinds call. No behavioural change to the shortcut path.

`runWorkflow` branches on `def.trigger.kind`:

- **shortcut** (default): unchanged — subscribe `view_opened`, `triggersTrip`, then `fillPages`.
- **reaction**:
  1. resolve `{ channel, ts }` from `_message` (or `_channel`+`_ts`).
  2. subscribe to the Continue `message` event (`app_id === appId`) **before** reacting.
  3. `reactionsAdd({ channel, timestamp: ts, name: emoji })`.
  4. `await` the Continue message -> extract `container` (message_ts, attachment_id, channel_id),
     `action` (action_id, block_id, value), `serviceId` (= bot_id), `serviceTeamId` (= team).
  5. subscribe to `view_opened` **before** dispatching (WSS frame can precede the HTTP response).
  6. `blocksActions(...)` -> modal opens.
  7. `fillPages(...)` with that first view — existing logic, unchanged.

`RunOutput` gains nothing required; `functionExecutionId`/`triggerExecutionId` are
shortcut-only and may be omitted/empty for the reaction path (documented).

### 6. `--dry-run`

For the reaction path, dry-run prints: parsed `channel` + `ts`, the `emoji`, and the resolved
field values — and makes **zero** Slack calls. It must **not** add the reaction, because the
reaction is a real, visible side effect.

### 7. New workflow file (`workflows/extension-release-via-reaction.ts`)

Reuses the field/page definitions from `extension-release-versions.ts` (imports its `pages`
to avoid duplication), with:

```ts
trigger: { kind: "reaction", emoji: "accessibility", appId: "A092KLW9XXX" }
```

Payload adds `_message` (the target-thread permalink) alongside the existing field values.

### 8. Tests

- `permalink.test.ts` — parsing happy path + malformed inputs.
- `runner.test.ts` (extend) — reaction path with mocked deps: `reactionsAdd`, `blocksActions`,
  and `waitFor` returning a fake Continue `message` then a `view_opened`. Assert the dispatch
  payload (container/action/service ids) and that `fillPages` runs. Follows existing test style.
- Existing shortcut runner test must still pass (no regression from the `fillPages` refactor).

## Risks / trade-offs

- **Visible emoji side effect** — a real run adds `:accessibility:` to the target message; that
  *is* the trigger. Unavoidable for a reaction trigger. Dry-run never reacts.
- **`already_reacted`** — if the emoji is already on the message, `reactions.add` fails and the
  workflow won't fire. Surfaced as a clear, typed error.
- **Continue-DM matching** — matched by `app_id` + arrival after the reaction, bounded by the
  existing `waitFor` timeout. If bot DMs are noisy, tighten with a ts lower-bound.

## Out of scope

- Generalising other event-trigger types (scheduled, slash, etc.).
- An `extract`-style scaffolder for reaction workflows (the modal is reused from the existing
  shortcut workflow; no live capture needed).
