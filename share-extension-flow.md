# Slack Share-Extension Workflow — How It Works

How the share-extension command triggers a Slack workflow, uploads a file, and
submits the modal — and the auth gotchas that make it work.

## The core idea: drive the logged-in Slack app over CDP

This system never authenticates against Slack's API with its own credentials.
Instead it **drives your already-logged-in Slack desktop app over CDP (Chrome
DevTools Protocol)** and runs every API call *from inside Slack's own renderer*,
so it inherits your real session.

```
slack-cli launch  →  Slack starts with --remote-debugging-port=9222
       │
       ▼
   attach() over CDP  ──────────────►  Session { evaluate(), on(), close() }
       │
       ▼
   runShareExtension(): trigger → (wait for view_opened) → upload → submit
```

## 1. CDP connection — `packages/core/src/cdp/connect.ts:24`

`attach()` connects to Slack's debug port (default 9222):

- `CDP.List({ port })` lists targets; `findTarget()` picks the one whose URL
  contains `app.slack.com` (`connect.ts:18`).
- Enables `Runtime.enable()` (run JS in the page) and `Network.enable()` (sniff
  WebSocket frames).
- Returns a `Session` whose key primitive is **`evaluate(expression)`** — runs
  arbitrary JS inside the Slack renderer via `Runtime.evaluate` with
  `returnByValue` + `awaitPromise` (`connect.ts:41`). Everything is built on this.

## 2. Authentication — `packages/core/src/api/client.ts`

> ⚠️ **GOTCHA — Slack's web API needs TWO credentials, not one.**
> The session cookie `d` alone returns `{"ok":false,"error":"not_authed"}`.
> You **must also send the `xoxc-…` token in the request body**. See the comment
> at `client.ts:6-13`.

- **`HARVEST_TOKEN_JS`** (`client.ts:14`) — JS injected into the renderer that
  finds the `xoxc` token.
  > ⚠️ **GOTCHA — the token location moves between Slack versions.** The harvester
  > probes three fallbacks in order: `window.TS.boot_data.api_token`, then
  > `localStorage.localConfig_v2.teams[*].token`, then a regex scan of all of
  > localStorage (`xoxc-[A-Za-z0-9-]{40,}`). If Slack ships a new client and all
  > three miss, `apiCall` throws "could not locate xoxc token in renderer" —
  > that's the first place to look when things break.
- **`apiCall()`** (`client.ts:62`) — builds a JS expression that harvests the
  token, then POSTs to `/api/<path>` as `application/x-www-form-urlencoded` with
  body `token=<xoxc>&<params>` and `credentials: 'include'` (so the `d` cookie
  rides along). Because this `fetch` runs *inside the Slack page*, it's
  same-origin and fully authenticated — no token is ever stored on our side.

## 3. The upload — `packages/core/src/api/files.ts:27`

`uploadFile()` runs Slack's 3-step upload, all through the renderer:

1. **Reserve:** `apiCall("files.getUploadURL", { filename, length })` → returns a
   `file` id and a temporary signed `upload_url` (`files.ts:29`).
2. **Upload bytes:** the binary is Base64-encoded on the Node side, then a JS
   expression rebuilds it into a `Uint8Array` (`atob` → byte loop) and `fetch`es
   the `upload_url` with a **raw binary body** (`files.ts:40`).
   > ⚠️ **GOTCHA — omit `credentials` on the upload fetch.** The upload endpoint
   > rejects requests that trigger a CORS preflight, so unlike `apiCall` this
   > fetch does **not** pass `credentials`. Base64 is used (not a `[1,2,3,…]`
   > array literal) to keep the embedded payload ~33% larger instead of ~4×.
3. **Confirm:** `apiCall("files.completeUpload", { files: [{id, title}] })`
   finalizes and returns the real file id (`files.ts:59`).

## 4. Trigger + form submission — `packages/cli/src/share-extension/run.ts:34`

`runShareExtension()` ties it together; ordering is deliberate:

1. **Pre-subscribe to the modal (avoid a race).** Generate a `client_token`
   (`web-${Date.now()}`) and call `waitFor(stream, …)` *before* firing the
   trigger (`run.ts:41`).
   > ⚠️ **GOTCHA — `view_opened` arrives over the WebSocket, possibly before the
   > HTTP trip response.** Subscribing *after* `triggersTrip` races against the
   > frame. `waitFor` subscribes synchronously, and the listener matches on the
   > same `client_token`, so it must be attached first.
2. **Fire the trigger.** `triggersTrip()` (`api/workflows.ts:37`) calls
   `apiCall("workflows.triggers.trip", { url, context, run_precheck,
   client_token })`. `url` is the hardcoded shortcut (`run.ts:10`); context is
   `{ location: "slash_command", channel_id }`. Returns `function_execution_id`
   and `trigger_execution_id`.
3. **Await the modal.** `await viewPromise` resolves with the `view_opened`
   event (its `view_id` and `blocks`) captured off the WebSocket.
4. **Upload the zip** (section 3), getting `uploaded.id`.
5. **Build state + submit.** `buildState()` maps the workflow's known
   `action_id`s to the *live* `block_id`s from the just-opened view (block ids
   are regenerated per view instance), filling in the uploaded file id and the
   user's field values. `viewsSubmit()` (`api/views.ts:44`) then POSTs
   `views.submit` with that state — exactly as a human clicking "Submit" would.

## The WebSocket half of the Session

`Network.enable()` lets the Session subscribe to
`Network.webSocketFrameReceived` (`connect.ts:52`). Slack's real-time events —
new messages, and crucially the `view_opened` modal — flow over its WebSocket;
the stream parses frames into typed `SlackEvent`s. The share-extension flow only
needs `view_opened`; the daemon command uses the same mechanism for messages.

## TL;DR

Launch Slack with the debug port → CDP `attach` → harvest `xoxc` token + reuse
`d` cookie *inside the renderer* → fire `workflows.triggers.trip` → catch the
`view_opened` modal off the WebSocket → 3-step `files.*` upload → `views.submit`
the modal with the file id and field values. Auth is never reimplemented; every
call executes inside your logged-in Slack page.
