# Generalized Slack Workflow Trigger CLI — Design

Date: 2026-06-18

## Problem

We want a CLI that can trigger a Slack workflow (defined in this repo) with a
dynamic payload, support multi-page workflow modals, and upload files and link
them into the workflow's fields.

A working but **hardcoded, single-page** implementation already exists at
`../slack-workflow`. Its `packages/core` layer (CDP attach, token harvest,
`files.*` upload, `views.submit`, `workflows.triggers.trip`, WSS event stream)
is generic and reusable. Everything workflow-specific — trigger URL, channel,
and all `action_id`s — is baked into `packages/cli/src/share-extension/`.

This project generalizes that into a config-driven, multi-page,
payload-triggered CLI.

## Goals

1. Workflows are **defined in this repo** as reusable definitions; supports
   **multi-page** (multi-step modal) workflows.
2. A CLI **triggers a workflow by name with a JSON payload** carrying dynamic
   values.
3. **File upload + linking**: upload a local file via Slack's 3-step upload and
   link the returned file id into the workflow's `file_input` field.

## Non-goals

- Re-implementing Slack auth — the ported `core` already drives the logged-in
  Slack app over CDP and harvests the `xoxc` token inside the renderer.
- Triggering real Slack workflows during development/tests. All tests are
  mock-based; the ported share-extension definition is a **sample only** and is
  not fired against live Slack.
- URL-only "linking" or referencing pre-existing Slack files by id (only
  upload-then-link is in scope).

## Decisions (from brainstorming)

- **Starting point:** build from scratch in this repo.
- **Core reuse:** port `packages/core` from `../slack-workflow` nearly verbatim.
- **Workflow definition:** hybrid — TypeScript modules that are data-only for
  the common case, with optional hook functions for custom logic. One file
  format (no separate YAML + hook-resolution machinery).
- **Payload input:** JSON passed directly (`--payload '<json>'`) or via
  `--payload-file <path>`, keyed by the definition's field keys.
- **"Linking":** reference the uploaded file id in a `file_input` field.
- **Multi-page advance signal:** `response_action` of `push` or `update`
  (accompanied by a fresh `view_opened`) means "advance to the next page".

## Architecture & repo layout

Bun monorepo, mirroring the reference.

```
workflow-slack-new/
├── packages/
│   ├── core/                    # PORTED ~verbatim from ../slack-workflow
│   │   └── src/
│   │       ├── cdp/             # connect.ts, types.ts
│   │       ├── wss/             # stream.ts, events.ts, wait-for.ts
│   │       ├── api/             # client, files, views, workflows, conversations, index
│   │       └── index.ts
│   └── cli/
│       └── src/
│           ├── index.ts         # commander: launch, probe, trigger
│           ├── workflow/
│           │   ├── definition.ts  # WorkflowDefinition types + formatter vocabulary
│           │   ├── loader.ts      # load workflows/<name>.ts by name
│           │   ├── build-state.ts # generic action_id->block_id mapping + value formatting
│           │   └── runner.ts      # NEW: multi-page trigger->view->fill->submit loop
│           └── commands/
│               └── trigger.ts     # `slack-cli trigger <name> ...`
└── workflows/
    └── share-extension.ts       # the reference workflow, re-expressed as a definition (sample)
```

`core` keeps its `ApiClient` permission gating, Zod schemas, CDP attach, and
WSS `waitFor`. The single biggest **new** piece is `runner.ts` — the reference
only ever handled one `view_opened`/`views.submit`; we add the multi-page loop.

## Workflow definition (the hybrid)

A workflow is a TypeScript module in `workflows/` exporting a
`WorkflowDefinition`. Data-only for the common case; optional hooks for the rare
custom case.

```ts
export const shareExtension: WorkflowDefinition = {
  name: "share-extension",
  trigger: {
    url: "https://slack.com/shortcuts/Ft.../...",
    context: { location: "slash_command", channel_id: "C09HRTA7XXX" },
    // channel_id overridable from payload._channel if present
  },
  pages: [
    {
      fields: [
        { key: "extensionVersion", actionId: "289bff52-...", format: "plain" },
        { key: "jiraLink",         actionId: "f2cbee19-...", format: "bulletLink" },
        { key: "whomToTag",        actionId: "43f7fb13-...", format: "multiConversations" },
        { key: "attachment",       actionId: "17c5a750-...", format: "fileUpload" },
        { key: "reviewedBy",       actionId: "e488ec32-...", format: "conversation" },
      ],
    },
    // additional pages appended here for multi-page workflows
  ],

  // OPTIONAL hooks (escape hatch):
  // formatValue?(field, rawValue): unknown
  // buildContext?(payload): TriggerContext
  // shouldContinue?(submitResponse): boolean
};
```

### Definition types

```ts
type Format =
  | "plain"               // plain_text_input
  | "bulletText"          // rich-text bullet, plain text
  | "bulletLink"          // rich-text bullet, link
  | "multiConversations"  // multi_conversations_select (string[])
  | "conversation"        // conversations_select (string)
  | "fileUpload";         // upload local file -> link id as file_input

interface FieldDef {
  key: string;            // payload key
  actionId: string;       // Slack action_id (stable across view instances)
  format: Format;
  optional?: boolean;     // default false -> required
}

interface PageDef { fields: FieldDef[]; }

interface TriggerDef {
  url: string;
  context: { location: string; channel_id: string };
}

interface WorkflowDefinition {
  name: string;
  trigger: TriggerDef;
  pages: PageDef[];
  formatValue?(field: FieldDef, raw: unknown): unknown;
  buildContext?(payload: Record<string, unknown>): TriggerDef["context"];
  shouldContinue?(resp: ViewsSubmitResponse): boolean;
}
```

- `format` is a fixed vocabulary ported from the reference's formatters
  (`plain`, `bulletText`, `bulletLink`, `multiConversations`, `conversation`,
  `fileUpload`). `fileUpload` is special — see Runner.
- A field is required by default; `optional: true` skips it when the payload
  omits the key (mirrors the reference's `if (f.notes)` guards).
- Unknown formats / missing required keys -> hard error before any Slack call.

## CLI & payload flow

```
slack-cli trigger share-extension \
  --payload '{"extensionVersion":"1.2.3","jiraLink":"https://...","whomToTag":["U123"],"attachment":"./build.zip","reviewedBy":"U999"}'
```

- `--payload '<json>'` (inline) **or** `--payload-file <path>`. Exactly one
  required.
- Payload is a flat JSON object keyed by the definition's field `key`s (keys
  unique across pages). `fileUpload` fields carry a **local file path** string.
- `--dry-run` resolves and validates the payload and prints the state it would
  submit per page, without firing the trigger (ported from reference).
- Reserved keys prefixed `_` (e.g. `_channel`) feed the trigger context, not
  form fields.

Flow: `attach()` -> `loadWorkflow(name)` -> validate payload against def -> run
the multi-page loop.

## Multi-page runner + file upload/linking (`runner.ts`)

```
1. Generate client_token; pre-subscribe waitFor(view_opened, client_token)  # race-safe
2. triggersTrip(url, context, client_token)
3. LOOP over pages (p = 0,1,2,...):
     a. view = await viewPromise               # the just-opened modal
     b. blockIds = blockIdMap(view.blocks)     # live action_id -> block_id
     c. for each fileUpload field on page[p]: uploadFile(path) -> file id  # 3-step upload
     d. state = buildState(page[p].fields, payload, blockIds, uploadedIds)
     e. resp = viewsSubmit(view.view_id, state)
     f. advance = def.shouldContinue?(resp)
                  ?? (resp.response_action in {push, update})
        if advance AND more pages remain:
            re-subscribe waitFor(view_opened); continue
        else: break
4. Report function_execution_id + pages submitted.
```

- **File upload + linking:** for each `fileUpload` field, read the local path,
  run the ported 3-step `uploadFile` (reserve -> binary POST -> confirm), then
  `buildState` links the returned id as `{ type: "file_input", files: [{ id }] }`
  into the live block — exactly the reference's mechanism, now def-driven.
- **Def/view mismatch guard:** if a page's view lacks an expected `action_id`,
  `buildState` throws (same as reference) — signals the def drifted from the
  live workflow.
- **Safety:** loop bounded by `pages.length`; each `waitFor` carries a timeout
  (reference uses 15s).

## Error handling

- Validation errors (unknown workflow name, malformed def, missing required
  payload key, unknown format, unreadable file path) fire **before** any Slack
  API call, with a clear message naming the offending key/field.
- `waitFor` timeout -> error naming the page index that never opened.
- `buildState` action_id miss -> error naming the missing action_id and page.
- Slack API errors surface via the ported Zod `SlackError` parsing.

## Testing (Bun test runner, fixture-driven)

- `build-state.test.ts` — def + payload + recorded `view_opened` blocks ->
  expected `views.submit` state, including file-id linking.
- `runner.test.ts` — mock `Session`/stream; assert the trigger->view->submit
  loop for a 1-page and a 2-page def, including `response_action: push`
  advancing pages and the bounded-loop/timeout behavior.
- `loader.test.ts` — loads a def by name; rejects unknown names / malformed
  defs.
- `payload.test.ts` — missing required key and unknown-format errors fire before
  any Slack call.
- `core` ports the reference's existing tests unchanged.

## Open items

None blocking. YAML declarative definitions are deliberately deferred in favor
of TS-module definitions (one file format). Referencing pre-existing Slack files
by id is out of scope.
