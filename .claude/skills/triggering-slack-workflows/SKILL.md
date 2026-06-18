---
name: triggering-slack-workflows
description: Use when you need to fire, trigger, or automate a Slack workflow shortcut (a multi-field modal form) from the command line or a script — filling its fields, selecting users/channels, or uploading a file into it — as yourself with no Slack app, bot token, or OAuth. Also use when tempted to DOM-automate app.slack.com or write Playwright/browser scripts to drive a Slack modal.
---

# Triggering Slack Workflows

## Overview

This repo ships a CLI (`slack-cli`) that triggers Slack workflow shortcuts by driving
your already-logged-in Slack **desktop app** over CDP and calling Slack's own API from
inside its renderer (`workflows.triggers.trip` → catch `view_opened` → `files.*` upload
→ `views.submit`). Auth is inherited from your session (`d` cookie + live `xoxc` token).

**Do NOT DOM-automate `app.slack.com` or write Playwright/browser scripts for the modal.**
Slack regenerates `block_id`s per view and the DOM is brittle; this CLI talks to Slack's
real API and resolves the live block ids for you. If you're reaching for a browser, stop
and use this CLI.

Full reference: `README.md` at the repo root.

## The path (always dry-run before a real run)

```bash
# invoke: `bun packages/cli/bin/slack-cli <cmd>`  (or `bun link --cwd packages/cli` once, then `slack-cli`)

# 1. Slack must run with the CDP debug port. Use restart if Slack is already open
#    (a plain relaunch won't add the flag).
bun packages/cli/bin/slack-cli restart            # or `launch` if Slack is closed

# 2. Validate + preview — ZERO Slack contact. Do this first, every time.
bun packages/cli/bin/slack-cli trigger <name> --dry-run --payload-file ./payload.json

# 3. Fire for real.
bun packages/cli/bin/slack-cli trigger <name> --payload-file ./payload.json
```

## Commands

| Command | Use |
|---|---|
| `ensure-debug` | start Slack in debug mode only if it isn't already (no-op when already set up) |
| `restart` / `launch` | get Slack running with `--remote-debugging-port=9222` |
| `list [--json]` | list all workflows in `workflows/` with metadata (name, channel, trigger, field count) |
| `trigger <name> --payload\|--payload-file [--dry-run]` | run a workflow defined in `workflows/<name>.ts` |
| `run --workflow\|--workflow-file --payload\|--payload-file [--dry-run]` | run a workflow whose definition is passed as JSON at runtime |
| `extract <trigger-url> --name <n> --channel <id>` | open a workflow's modal and scaffold `workflows/<n>.ts` (never submits) |

## Payload rules

Flat JSON keyed by the definition's field `key`s. Field formats: `plain`, `richText`,
`link` (clickable URL), `bulletText`, `bulletLink`, `multiConversations` (ID array),
`conversation` (one ID), `fileUpload`, `checkboxes`.

- A `fileUpload` field's value is a **local file path** — the CLI uploads it and links the
  file id into the modal's `file_input`.
- Conversation/user fields take **Slack IDs** (`U…`/`C…`), not names.
- `autolink: true` on a `richText`/`bulletText` field highlights pasted URLs inside the text.
- `checkboxes`: pass `true` (tick all) or an array of option values; omit = unchecked. `extract` captures the option catalog.
- Add `"_channel": "C…"` to override the definition's channel for one run.

## Gotchas

- **"Couldn't reach Slack on localhost:9222"** → Slack isn't in debug mode; run `restart`.
- **Enterprise Grid** restricts `conversations.list`, so pass channel **IDs** (not `#name`).
  Get an ID from the channel → *View channel details* (or *Copy link* → last path segment).
- **`rich_text_input` is ambiguous** — `extract` defaults such fields to `richText` and warns;
  switch to `bulletText`/`bulletLink` if the field is really bulleted or a link.
- **`buildState: no block_id in view for action_id <X>`** → the Slack form changed and the
  definition drifted. Re-run `extract` and update the definition. `action_id`s are stable;
  `block_id`s are per-view and resolved live (never hardcode them).
