// Extract a Slack workflow definition from a Chrome HAR capture.
// Usage: bun scripts/har-extract.ts "<path-to.har>"
//
// Finds the workflows.triggers.trip trigger (url + context) and the view_opened
// modal(s) captured over the WebSocket, and prints the action_ids + element types
// for each page so we can author a WorkflowDefinition.

import { readFileSync } from "node:fs";

const harPath = process.argv[2];
if (!harPath) {
  console.error("usage: bun scripts/har-extract.ts <path-to.har>");
  process.exit(1);
}

const har = JSON.parse(readFileSync(harPath, "utf8"));
const entries: any[] = har.log.entries;

function formField(postData: any, name: string): string | undefined {
  if (!postData) return undefined;
  if (Array.isArray(postData.params)) {
    const p = postData.params.find((x: any) => x.name === name);
    if (p) return decodeURIComponent(p.value ?? "");
  }
  const text: string = postData.text ?? "";
  // application/x-www-form-urlencoded fallback
  for (const kv of text.split("&")) {
    const i = kv.indexOf("=");
    if (i > 0 && decodeURIComponent(kv.slice(0, i)) === name) {
      return decodeURIComponent(kv.slice(i + 1).replace(/\+/g, " "));
    }
  }
  return undefined;
}

// 1) Trigger trip(s)
console.log("================ workflows.triggers.trip ================");
for (const e of entries) {
  if (!/\/api\/workflows\.triggers\.trip/.test(e.request.url)) continue;
  const url = formField(e.request.postData, "url");
  const context = formField(e.request.postData, "context");
  const client_token = formField(e.request.postData, "client_token");
  console.log("url:    ", url);
  console.log("context:", context);
  console.log("client_token:", client_token);
  console.log("---");
}

// 2) view_opened frames over the WebSocket
function collectViewOpened(): any[] {
  const views: any[] = [];
  for (const e of entries) {
    const msgs = e._webSocketMessages;
    if (!Array.isArray(msgs)) continue;
    for (const m of msgs) {
      if (typeof m.data !== "string") continue;
      if (!m.data.includes("view_opened")) continue;
      try {
        const obj = JSON.parse(m.data);
        if (obj.type === "view_opened") views.push(obj);
      } catch {
        // not JSON / partial
      }
    }
  }
  return views;
}

const views = collectViewOpened();
console.log(`\n================ view_opened events: ${views.length} ================`);

function describeBlocks(blocks: any[] | undefined) {
  for (const b of blocks ?? []) {
    const el = b.element ?? {};
    const label = b.label?.text ?? "";
    console.log(
      `  block_id=${b.block_id}  action_id=${el.action_id ?? "(none)"}  type=${el.type ?? b.type ?? "?"}  label="${label}"`,
    );
  }
}

views.forEach((v, i) => {
  console.log(`\n--- view_opened #${i}  view_id=${v.view_id}  client_token=${v.client_token ?? ""}  callback_id=${v.view?.callback_id ?? ""} title="${v.view?.title?.text ?? ""}" ---`);
  describeBlocks(v.view?.blocks);
});

// 3) views.submit state (shows how the client formatted each value)
console.log(`\n================ views.submit payloads ================`);
for (const e of entries) {
  if (!/\/api\/views\.submit/.test(e.request.url)) continue;
  const state = formField(e.request.postData, "state");
  const view_id = formField(e.request.postData, "view_id");
  console.log(`view_id=${view_id}`);
  if (state) {
    try { console.log(JSON.stringify(JSON.parse(state), null, 2)); }
    catch { console.log(state); }
  }
  console.log("---");
}
