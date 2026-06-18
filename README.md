# slack-workflow-trigger

A CLI that triggers Slack **workflow** shortcuts (the multi-field modal forms) with a
dynamic payload — filling fields, uploading and linking files, and walking multi-page
modals — by driving your already-logged-in Slack **desktop app** over CDP (Chrome
DevTools Protocol).

It never re-implements Slack auth. Every API call runs *inside* Slack's own renderer,
so it inherits your real session (the `d` cookie + the `xoxc` token harvested live from
the page). Nothing is triggered unless you ask; `--dry-run` validates and previews with
zero Slack contact.

## How it works

```
slack-cli launch / restart   →  Slack starts with --remote-debugging-port=9222
        │
        ▼
   attach() over CDP  ─────────►  run JS inside the Slack renderer
        │
        ▼
   trigger / run:  trip the workflow → catch the view_opened modal off the
                   WebSocket → upload files → fill fields → views.submit
```

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- The Slack **desktop app** (macOS path is hardcoded: `/Applications/Slack.app`)
- You must be logged into Slack and a member of any channel you trigger from

## Install

```bash
bun install
```

Run the CLI either with the full path:

```bash
bun packages/cli/bin/slack-cli <command>
```

…or link it once so you can type `slack-cli` directly:

```bash
bun link --cwd packages/cli      # then: slack-cli <command>
```

The examples below use `slack-cli` for brevity.

## Build (run without Bun)

The CLI also bundles to plain JavaScript that runs on any Node ≥ 18 — no Bun, no
experimental flags:

```bash
bun install            # or: npm install   (installs esbuild, a dev dependency)
bun run build          # or: npm run build / node scripts/build.mjs
node dist/slack-cli.mjs list
node dist/slack-cli.mjs trigger <name> --payload-file ./payload.json
```

`build` produces a self-contained `dist/slack-cli.mjs` (all deps bundled) plus
`dist/workflows/*.mjs` (each `workflows/*.ts` compiled). The loader imports the
compiled `.mjs` at runtime, so **re-run `build` after adding or editing a workflow**.
Point `SLACK_CLI_WORKFLOWS_DIR` at another directory to load workflows from elsewhere.
(Dev still runs straight from source under Bun via `bun packages/cli/bin/slack-cli`.)

## Quick start

```bash
# 1. Start Slack with the debug port open
slack-cli restart                       # quits a running Slack, relaunches in debug mode
#   (or `slack-cli launch` if Slack isn't open yet)

# 2. Preview a trigger — no Slack calls
slack-cli trigger share-extension-v2 --dry-run --payload '{ ... }'

# 3. Fire it for real
slack-cli trigger share-extension-v2 --payload-file ./payload.json
```

## Commands

### `launch` / `restart`

Get Slack running with the CDP debug port (default `9222`) enabled.

```bash
slack-cli launch                 # spawn Slack with --remote-debugging-port=9222
slack-cli restart                # quit a running Slack first, then relaunch (use this if
                                 # Slack is already open — a second launch won't add the flag)
slack-cli restart -p 9333        # custom port
```

Verify it's live: open `http://localhost:9222/json` — you should see an `app.slack.com` target.

### `list` — see the available workflows

Lists every workflow in `workflows/` with identifying metadata (description, pages, fields,
channel, trigger URL). Add `--json` for machine-readable output.

```bash
slack-cli list
slack-cli list --json
```

### `trigger <name>` — run a workflow defined in this repo

Loads `workflows/<name>.ts` and triggers it with your payload.

```bash
slack-cli trigger <name> --payload '<json>'        # inline values
slack-cli trigger <name> --payload-file ./p.json   # or from a file
slack-cli trigger <name> --dry-run --payload '...' # validate + preview, no Slack calls
slack-cli trigger <name> --payload '...' -p 9222   # CDP port (must match how Slack launched)
```

Exactly one of `--payload` / `--payload-file` is required.

### `run` — run a workflow supplied at runtime

Same as `trigger`, but the workflow **definition** is passed as JSON too — the template
does not need to live in `workflows/`.

```bash
slack-cli run --workflow '<definition-json>' --payload '<values-json>' [--dry-run]
slack-cli run --workflow-file ./wf.json --payload-file ./p.json
```

Definitions passed this way are data-only (no code hooks — see *Hooks* below).

### `extract <trigger-url>` — scaffold a definition from a live modal

Trips a workflow trigger, captures the live `view_opened` modal, and writes a
`WorkflowDefinition` into the dir the loader reads from — **relative to the CLI, not your
cwd** (`SLACK_CLI_WORKFLOWS_DIR`, else the workflows dir beside the CLI). It writes `.ts`
when running from source under Bun, and a plain-ESM `.mjs` when running from the Node
bundle (so the bundle can load it immediately). **It never submits**, so nothing is posted.

```bash
slack-cli extract "https://slack.com/shortcuts/Ft.../..." \
  --name my-workflow --channel C0123456789
```

It reads field labels (→ keys), element types (→ formats), and required/optional straight
from the modal. See *Extracting workflows* for the one ambiguity it flags.

## Workflow definitions

A workflow lives in `workflows/<name>.ts` and `export default`s a `WorkflowDefinition`:

```ts
import type { WorkflowDefinition } from "../packages/cli/src/workflow/definition.ts";

const def: WorkflowDefinition = {
  name: "my-workflow",
  trigger: {
    url: "https://slack.com/shortcuts/Ft.../...",   // the shortcut/trigger URL
    context: { location: "slash_command", channel_id: "C0123456789" },
  },
  pages: [
    {
      fields: [
        { key: "version",   actionId: "289bff52-…", format: "plain" },
        { key: "jiraLink",  actionId: "f2cbee19-…", format: "richText" },
        { key: "tag",       actionId: "43f7fb13-…", format: "multiConversations" },
        { key: "reviewer",  actionId: "e488ec32-…", format: "conversation" },
        { key: "build",     actionId: "17c5a750-…", format: "fileUpload" },
        { key: "notes",     actionId: "64ed8fa1-…", format: "richText", optional: true },
      ],
    },
    // add more pages for multi-page modals
  ],
};

export default def;
```

- An optional top-level **`description`** string is surfaced by `slack-cli list`.
- **`autolink: true`** on a `richText`/`bulletText` field turns any pasted URL in the value
  into a highlighted, clickable link element (Slack's paste behaviour). Ignored by other formats.
- **`actionId`** values are baked into the Slack workflow and stay stable across runs.
  (Per-view `block_id`s change every time and are resolved live — never hardcode them.)
- A field is **required** unless marked `optional: true`.
- `key` is the payload key the value is read from.

### Field formats

| `format`             | Slack input it fills                         | Payload value      |
|----------------------|----------------------------------------------|--------------------|
| `plain`              | `plain_text_input`                           | string             |
| `richText`           | `rich_text_input` (plain section)            | string             |
| `bulletText`         | `rich_text_input` (bulleted text)            | string             |
| `bulletLink`         | `rich_text_input` (bulleted link)            | URL string         |
| `link`               | `rich_text_input` (inline clickable link)    | URL string         |
| `multiConversations` | `multi_conversations_select`                 | string[] of IDs    |
| `conversation`       | `conversations_select`                       | user/channel ID    |
| `fileUpload`         | `file_input` (upload + link the file id)     | local file path    |
| `checkboxes`         | `checkboxes` (option catalog captured by `extract`) | `true` (tick all) or array of option values |

### Hooks (optional, TS definitions only)

A definition may add code hooks for custom behaviour. These are functions, so they only
work in TS modules — not in JSON passed to `run`.

```ts
formatValue?(field, raw): unknown                 // override a field's formatter
buildContext?(payload): { location, channel_id }  // derive the trigger context from the payload
shouldContinue?(submitResponse): boolean          // decide whether to advance to the next page
```

## Payloads

A payload is a flat JSON object keyed by the definition's field `key`s:

```json
{
  "version": "5.9.0.0",
  "jiraLink": "https://jira/X-9",
  "tag": ["U06BKT4MXXX"],
  "reviewer": "U06BKT4MXXX",
  "build": "./build.zip",
  "notes": "optional note"
}
```

- **File uploads:** a `fileUpload` field's value is a **local file path**. The CLI runs
  Slack's 3-step upload and links the returned file id into the modal's `file_input`.
- **Channel override:** a reserved `"_channel": "C…"` key overrides the definition's
  `trigger.context.channel_id` for this run (precedence: `buildContext` hook → `_channel`
  → the definition's static channel).
- **Checkboxes:** pass `true` to tick all options, or an array of option **values** to tick
  specific ones; omit (or `false`) to leave unchecked (the field is left out of the submit). The
  option catalog is captured automatically by `extract`.
- Omitted `optional` fields are simply skipped.

## Dry-run

Add `--dry-run` to `trigger` or `run` to validate the definition + payload and print the
resolved trigger context and per-page field values **without contacting Slack**:

```
[dry-run] workflow "my-workflow"
[dry-run] trigger url: https://slack.com/shortcuts/Ft.../...
[dry-run] context: {"location":"slash_command","channel_id":"C0123456789"}
[dry-run] page 0:
[dry-run]   version [plain] = "5.9.0.0"
[dry-run]   build [fileUpload] = "./build.zip" (upload local file: ./build.zip)
[dry-run] no Slack calls made
```

## Extracting workflows

Two ways to turn an existing Slack form into a definition:

1. **Live (recommended):** `slack-cli extract <trigger-url> --name <n> --channel <id>` —
   opens the modal and reads labels, element types, and required/optional from it.
2. **From a HAR:** `bun scripts/har-extract.ts "<path-to.har>"` prints the trigger URL and
   the `action_id → element-type` mapping from a captured `views.submit`. Useful when you
   already have a network capture.

**The one ambiguity:** `rich_text_input` fields can be plain, bulleted, or a link, and the
modal alone can't say which — `extract` defaults them to `richText` and prints a warning per
field. Switch any of them to `bulletText` / `bulletLink` if needed (a real submission, e.g.
from a HAR, tells you which the field is actually used as).

**Finding a channel ID:** on Enterprise Grid, `conversations.list` is often restricted, so
pass the channel **ID** (not `#name`). Get it from the channel → *View channel details*, or
right-click → *Copy link* (the ID is the last path segment).

## Project layout

```
packages/
  core/     CDP attach, xoxc token harvest, files upload, views.submit, triggers.trip, WSS stream
  cli/      commands (launch/restart/extract/trigger/run) + workflow loader, validation, runner
workflows/  your WorkflowDefinition modules
scripts/    har-extract.ts (offline HAR → field mapping)
```

## Testing

```bash
bun test          # full suite (mock-based; never contacts Slack)
bun run typecheck  # tsc -b --noEmit
```

## Troubleshooting

- **"Couldn't reach Slack on localhost:9222"** — Slack isn't running with the debug port.
  Run `slack-cli restart`.
- **"could not locate xoxc token in renderer"** — Slack moved the token location in a new
  client version. See `packages/core/src/api/client.ts` (`HARVEST_TOKEN_JS`).
- **`enterprise_is_restricted` on conversations.list** — your Grid restricts that API; pass
  channel **IDs** directly instead of names.
- **`buildState: no block_id in view for action_id <X>`** — the workflow's form changed in
  Slack and the definition has drifted. Re-extract it (`slack-cli extract …`) and update the
  definition.
