# Slack Workflow Trigger CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A CLI that triggers a named, repo-defined Slack workflow with a JSON payload, walks its (possibly multi-page) modal, uploads files, and links the uploaded file ids into the workflow's fields.

**Architecture:** Bun monorepo mirroring `../slack-workflow`. `packages/core` is ported verbatim (CDP attach, token harvest, `files.*` upload, `views.submit`, `workflows.triggers.trip`, WSS stream/waitFor). New work lives in `packages/cli/src/workflow/` (definition types, loader, payload validation, generic build-state, multi-page runner) and a `workflows/` directory of `WorkflowDefinition` modules. The runner generalizes the reference's single-view flow into a bounded page loop.

**Tech Stack:** Bun (runtime + `bun:test`), TypeScript (strict, `verbatimModuleSyntax`, `allowImportingTsExtensions`), Commander, Zod, `chrome-remote-interface`.

## Global Constraints

- Runtime is **Bun**. Tests use `import { test, expect, mock } from "bun:test"`. Run with `bun test`.
- All intra-package imports use explicit `.ts` / `.tsx` extensions (tsconfig `allowImportingTsExtensions` + `verbatimModuleSyntax`).
- `tsconfig.base.json` is copied verbatim from the reference: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` all on — code must satisfy these.
- Type-only imports must use `import type` (verbatimModuleSyntax).
- Never trigger a real Slack workflow. Tests are mock-based; `workflows/share-extension.ts` is a sample, never fired in tests.
- Repo root: `/Users/rohandebroy/area51/workflow-slack-new`. Reference repo (source for the port): `/Users/rohandebroy/area51/slack-workflow`.

---

### Task 1: Monorepo scaffold + port `packages/core` verbatim

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`
- Create (by copy): `packages/core/**` (src + tests + package.json + tsconfig.json)
- Test: the ported `packages/core/tests/**` (run as-is)

**Interfaces:**
- Consumes: nothing.
- Produces: the `@slack-automate/core` package exporting `attach`, `createStream`, `waitFor`, `WaitForTimeoutError`, `triggersTrip`, `viewsSubmit`, `viewsGet`, `uploadFile`, `conversationsList`, `conversationsMark`, `createApiClient`, `harvestSelfUserId`, and types `Session`, `ConnectOptions`, `EventStream`, `SlackEvent`, `ChannelMap`, `ApiClient`, `ApiPermission`. The `view_opened` event shape is `{ type: "view_opened", view_id: string, client_token?: string, trigger_execution_id?: string, view?: { id: string, blocks?: { block_id: string, element?: { action_id?: string } }[] } }`. `ViewsSubmitResponse` is `{ ok: true, view?: null, response_action: string }`.

- [ ] **Step 1: Initialize git and create root manifests**

```bash
cd /Users/rohandebroy/area51/workflow-slack-new
git init
```

Create `package.json`:

```json
{
  "name": "slack-workflow-trigger",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "typecheck": "tsc -b --noEmit",
    "test": "bun test"
  },
  "devDependencies": {
    "@types/bun": "^1.1.0",
    "typescript": "^5.5.0"
  }
}
```

Create `tsconfig.base.json` (copied verbatim from the reference):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["bun"]
  }
}
```

Create `.gitignore`:

```
node_modules
*.log
.DS_Store
```

- [ ] **Step 2: Copy the core package verbatim from the reference**

```bash
cd /Users/rohandebroy/area51/workflow-slack-new
mkdir -p packages
cp -R /Users/rohandebroy/area51/slack-workflow/packages/core packages/core
```

This brings over `packages/core/src/{index.ts,cdp/,wss/,api/}`, `packages/core/tests/**` (incl. `fixtures/`), `packages/core/package.json`, and `packages/core/tsconfig.json`. The core code has zero dependency on the CLI package, so it ports cleanly. Do not edit any copied file.

- [ ] **Step 3: Install dependencies**

```bash
cd /Users/rohandebroy/area51/workflow-slack-new
bun install
```

Expected: resolves `chrome-remote-interface`, `zod`, `@types/*`, links the `@slack-automate/core` workspace.

- [ ] **Step 4: Run the ported core tests to verify green**

Run: `bun test packages/core`
Expected: PASS — all ported core suites (`api-client`, `api-permission`, `cdp-bun-smoke`, `connect`, `conversations`, `files`, `views`, `workflows`, `wss`) green. If `cdp-bun-smoke` requires a live Slack and is skipped/guarded in the reference, it stays as-is.

- [ ] **Step 5: Commit**

```bash
cd /Users/rohandebroy/area51/workflow-slack-new
git add -A
git commit -m "chore: scaffold monorepo and port @slack-automate/core verbatim"
```

---

### Task 2: CLI package scaffold + workflow definition types

**Files:**
- Create: `packages/cli/package.json`, `packages/cli/tsconfig.json`, `packages/cli/bin/slack-cli`
- Create: `packages/cli/src/workflow/definition.ts`
- Test: none (pure types + manifests; verified by typecheck in later tasks)

**Interfaces:**
- Consumes: `@slack-automate/core` (Task 1) — re-exports its `ViewsSubmitResponse` type via core's public surface.
- Produces: types `Format`, `FieldDef`, `PageDef`, `TriggerContext`, `TriggerDef`, `WorkflowDefinition`. Used by Tasks 3–7.

- [ ] **Step 1: Create the CLI package manifest**

`packages/cli/package.json`:

```json
{
  "name": "@slack-automate/cli",
  "private": true,
  "type": "module",
  "bin": { "slack-cli": "./bin/slack-cli" },
  "dependencies": {
    "@slack-automate/core": "workspace:*",
    "commander": "^12.1.0",
    "zod": "^3.23.0"
  }
}
```

`packages/cli/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*", "bin/**/*", "tests/**/*"]
}
```

`packages/cli/bin/slack-cli` (mark executable in Step 3):

```
#!/usr/bin/env bun
import("../src/index.ts").then((m) => m.run(process.argv));
```

- [ ] **Step 2: Define the workflow definition types**

`packages/cli/src/workflow/definition.ts`:

```ts
import type { ViewsSubmitResponse } from "@slack-automate/core";

/** Built-in value formatters. Maps a payload value to a Slack view-state value. */
export type Format =
  | "plain"               // plain_text_input
  | "bulletText"          // rich_text_input, single bullet of plain text
  | "bulletLink"          // rich_text_input, single bullet containing a link
  | "multiConversations"  // multi_conversations_select (expects string[])
  | "conversation"        // conversations_select (expects string)
  | "fileUpload";         // upload a local file, link the returned id as file_input

export interface FieldDef {
  /** Key looked up in the payload. For `fileUpload`, the value is a local file path. */
  key: string;
  /** Slack action_id — stable across view instances (block_ids are not). */
  actionId: string;
  format: Format;
  /** When true, the field is skipped if the payload omits its key. Default: required. */
  optional?: boolean;
}

export interface PageDef {
  fields: FieldDef[];
}

export interface TriggerContext {
  location: string;
  channel_id: string;
}

export interface TriggerDef {
  url: string;
  context: TriggerContext;
}

export interface WorkflowDefinition {
  name: string;
  trigger: TriggerDef;
  /** Ordered modal pages. One page = one view_opened -> views.submit cycle. */
  pages: PageDef[];

  // ---- optional hooks (escape hatch for custom workflows) ----
  /** Override the built-in formatter for a field. Return the Slack view-state value. */
  formatValue?(field: FieldDef, raw: unknown): unknown;
  /** Derive the trigger context from the payload (overrides trigger.context). */
  buildContext?(payload: Record<string, unknown>): TriggerContext;
  /** Decide whether to advance to the next page. Default: response_action is push/update. */
  shouldContinue?(resp: ViewsSubmitResponse): boolean;
}
```

- [ ] **Step 3: Make the bin executable and typecheck**

```bash
cd /Users/rohandebroy/area51/workflow-slack-new
chmod +x packages/cli/bin/slack-cli
bun install
bun run typecheck
```

Expected: typecheck PASS (no `src/index.ts` yet is fine — it's created in Task 7; `tsc -b` only checks existing files referenced by includes; if `tsc` complains about the missing bin import target, ignore until Task 7, the bin is not type-checked).

> If `bun run typecheck` errors solely because `packages/cli/src/index.ts` does not exist yet, that is expected and resolved in Task 7. All other errors must be fixed now.

- [ ] **Step 4: Commit**

```bash
cd /Users/rohandebroy/area51/workflow-slack-new
git add -A
git commit -m "feat: scaffold @slack-automate/cli and workflow definition types"
```

---

### Task 3: Generic build-state (formatters + view-state assembly)

**Files:**
- Create: `packages/cli/src/workflow/build-state.ts`
- Test: `packages/cli/tests/build-state.test.ts`

**Interfaces:**
- Consumes: `FieldDef`, `PageDef`, `WorkflowDefinition` (Task 2).
- Produces:
  - `blockIdMap(blocks?: { block_id: string; element?: { action_id?: string } }[]): Map<string,string>` — live action_id -> block_id.
  - `buildState(page: PageDef, payload: Record<string, unknown>, blockIds: Map<string,string>, uploadedIds: Map<string,string>, hooks?: Pick<WorkflowDefinition,"formatValue">): { values: Record<string, Record<string, unknown>> }`. `uploadedIds` is keyed by `FieldDef.key`. Throws `Error` when a required field's value is missing or a needed action_id is absent from the view.

- [ ] **Step 1: Write the failing test**

`packages/cli/tests/build-state.test.ts`:

```ts
import { test, expect } from "bun:test";
import { blockIdMap, buildState } from "../src/workflow/build-state.ts";
import type { PageDef } from "../src/workflow/definition.ts";

const page: PageDef = {
  fields: [
    { key: "extensionVersion", actionId: "A_ext", format: "plain" },
    { key: "jiraLink", actionId: "A_jira", format: "bulletLink" },
    { key: "changelog", actionId: "A_chg", format: "bulletText" },
    { key: "whomToTag", actionId: "A_tag", format: "multiConversations" },
    { key: "reviewedBy", actionId: "A_rev", format: "conversation" },
    { key: "notes", actionId: "A_notes", format: "bulletText", optional: true },
    { key: "attachment", actionId: "A_file", format: "fileUpload" },
  ],
};

const blocks = [
  { block_id: "B_ext", element: { action_id: "A_ext" } },
  { block_id: "B_jira", element: { action_id: "A_jira" } },
  { block_id: "B_chg", element: { action_id: "A_chg" } },
  { block_id: "B_tag", element: { action_id: "A_tag" } },
  { block_id: "B_rev", element: { action_id: "A_rev" } },
  { block_id: "B_file", element: { action_id: "A_file" } },
];

test("blockIdMap maps action_id -> block_id", () => {
  const m = blockIdMap(blocks);
  expect(m.get("A_ext")).toBe("B_ext");
  expect(m.size).toBe(6);
});

test("buildState formats each field and links the uploaded file id", () => {
  const blockIds = blockIdMap(blocks);
  const uploaded = new Map([["attachment", "F123"]]);
  const { values } = buildState(
    page,
    { extensionVersion: "1.2.3", jiraLink: "https://j", changelog: "did stuff", whomToTag: ["U1", "U2"], reviewedBy: "U9" },
    blockIds,
    uploaded,
  );
  expect(values["B_ext"]).toEqual({ A_ext: { type: "plain_text_input", value: "1.2.3" } });
  expect(values["B_tag"]).toEqual({ A_tag: { type: "multi_conversations_select", selected_conversations: ["U1", "U2"] } });
  expect(values["B_rev"]).toEqual({ A_rev: { type: "conversations_select", selected_conversation: "U9" } });
  expect(values["B_file"]).toEqual({ A_file: { type: "file_input", files: [{ id: "F123" }] } });
  // optional 'notes' omitted from payload -> absent
  expect(values["B_notes"]).toBeUndefined();
  // bulletLink shape
  expect((values["B_jira"]!.A_jira as any).type).toBe("rich_text_input");
});

test("buildState throws when a required field's payload value is missing", () => {
  const blockIds = blockIdMap(blocks);
  expect(() =>
    buildState(page, { jiraLink: "https://j", changelog: "c", whomToTag: ["U1"], reviewedBy: "U9" }, blockIds, new Map([["attachment", "F1"]])),
  ).toThrow(/missing required field "extensionVersion"/);
});

test("buildState throws when the view lacks a needed action_id", () => {
  const blockIds = blockIdMap(blocks.filter((b) => b.element.action_id !== "A_ext"));
  expect(() =>
    buildState(page, { extensionVersion: "1.2.3", jiraLink: "https://j", changelog: "c", whomToTag: ["U1"], reviewedBy: "U9" }, blockIds, new Map([["attachment", "F1"]])),
  ).toThrow(/no block_id in view for action_id A_ext/);
});

test("formatValue hook overrides the default formatter", () => {
  const blockIds = blockIdMap(blocks);
  const { values } = buildState(
    { fields: [{ key: "extensionVersion", actionId: "A_ext", format: "plain" }] },
    { extensionVersion: "1.2.3" },
    blockIds,
    new Map(),
    { formatValue: (f, raw) => ({ type: "custom", k: f.key, v: raw }) },
  );
  expect(values["B_ext"]).toEqual({ A_ext: { type: "custom", k: "extensionVersion", v: "1.2.3" } });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/rohandebroy/area51/workflow-slack-new && bun test packages/cli/tests/build-state.test.ts`
Expected: FAIL — `Cannot find module '../src/workflow/build-state.ts'`.

- [ ] **Step 3: Write minimal implementation**

`packages/cli/src/workflow/build-state.ts`:

```ts
import type { FieldDef, PageDef, WorkflowDefinition } from "./definition.ts";

interface OpenedBlock {
  block_id: string;
  element?: { action_id?: string | undefined } | undefined;
}

/** Slack regenerates block_ids per view instance; action_ids are stable. */
export function blockIdMap(blocks: OpenedBlock[] | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const b of blocks ?? []) {
    const aid = b.element?.action_id;
    if (aid) m.set(aid, b.block_id);
  }
  return m;
}

const plain = (text: string) => ({ type: "plain_text_input" as const, value: text });

const bulletLink = (url: string) => ({
  type: "rich_text_input" as const,
  rich_text_value: {
    type: "rich_text",
    elements: [{
      type: "rich_text_list", style: "bullet", indent: 0, border: 0,
      elements: [{ type: "rich_text_section", elements: [{ type: "link", url }] }],
    }],
  },
});

const bulletText = (text: string) => ({
  type: "rich_text_input" as const,
  rich_text_value: {
    type: "rich_text",
    elements: [{
      type: "rich_text_list", style: "bullet", indent: 0, border: 0,
      elements: [{ type: "rich_text_section", elements: [{ type: "text", text }] }],
    }],
  },
});

function defaultFormat(field: FieldDef, raw: unknown): unknown {
  switch (field.format) {
    case "plain": return plain(String(raw));
    case "bulletText": return bulletText(String(raw));
    case "bulletLink": return bulletLink(String(raw));
    case "multiConversations": return { type: "multi_conversations_select", selected_conversations: raw as string[] };
    case "conversation": return { type: "conversations_select", selected_conversation: String(raw) };
    case "fileUpload": throw new Error(`buildState: fileUpload field "${field.key}" must resolve via uploadedIds`);
  }
}

export function buildState(
  page: PageDef,
  payload: Record<string, unknown>,
  blockIds: Map<string, string>,
  uploadedIds: Map<string, string>,
  hooks?: Pick<WorkflowDefinition, "formatValue">,
): { values: Record<string, Record<string, unknown>> } {
  const values: Record<string, Record<string, unknown>> = {};
  const put = (actionId: string, value: unknown) => {
    const blockId = blockIds.get(actionId);
    if (!blockId) throw new Error(`buildState: no block_id in view for action_id ${actionId}`);
    values[blockId] = { [actionId]: value };
  };

  for (const field of page.fields) {
    if (field.format === "fileUpload") {
      const id = uploadedIds.get(field.key);
      if (id === undefined) {
        if (field.optional) continue;
        throw new Error(`buildState: no uploaded file id for required field "${field.key}"`);
      }
      put(field.actionId, { type: "file_input", files: [{ id }] });
      continue;
    }
    const raw = payload[field.key];
    if (raw === undefined) {
      if (field.optional) continue;
      throw new Error(`buildState: missing required field "${field.key}"`);
    }
    const value = hooks?.formatValue?.(field, raw) ?? defaultFormat(field, raw);
    put(field.actionId, value);
  }
  return { values };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/rohandebroy/area51/workflow-slack-new && bun test packages/cli/tests/build-state.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/rohandebroy/area51/workflow-slack-new
git add -A
git commit -m "feat: generic build-state with formatter vocabulary and file linking"
```

---

### Task 4: Payload validation (pre-flight, before any Slack call)

**Files:**
- Create: `packages/cli/src/workflow/validate.ts`
- Test: `packages/cli/tests/validate.test.ts`

**Interfaces:**
- Consumes: `WorkflowDefinition`, `FieldDef` (Task 2).
- Produces:
  - class `PayloadValidationError extends Error`.
  - `validatePayload(def: WorkflowDefinition, payload: Record<string, unknown>, fileExists?: (p: string) => boolean): void` — throws `PayloadValidationError` on: unknown format, missing required key, non-string `fileUpload` value, or missing file on disk. `fileExists` defaults to `node:fs` `existsSync` and is injectable for tests.

- [ ] **Step 1: Write the failing test**

`packages/cli/tests/validate.test.ts`:

```ts
import { test, expect } from "bun:test";
import { validatePayload, PayloadValidationError } from "../src/workflow/validate.ts";
import type { WorkflowDefinition } from "../src/workflow/definition.ts";

const def: WorkflowDefinition = {
  name: "t",
  trigger: { url: "u", context: { location: "slash_command", channel_id: "C1" } },
  pages: [{
    fields: [
      { key: "title", actionId: "A1", format: "plain" },
      { key: "notes", actionId: "A2", format: "bulletText", optional: true },
      { key: "attachment", actionId: "A3", format: "fileUpload" },
    ],
  }],
};

const allExist = () => true;

test("passes when required keys present and file exists", () => {
  expect(() => validatePayload(def, { title: "x", attachment: "./f.zip" }, allExist)).not.toThrow();
});

test("throws on missing required key", () => {
  expect(() => validatePayload(def, { attachment: "./f.zip" }, allExist)).toThrow(PayloadValidationError);
  expect(() => validatePayload(def, { attachment: "./f.zip" }, allExist)).toThrow(/missing required payload key "title"/);
});

test("optional key may be omitted", () => {
  expect(() => validatePayload(def, { title: "x", attachment: "./f.zip" }, allExist)).not.toThrow();
});

test("throws when fileUpload value is not a string path", () => {
  expect(() => validatePayload(def, { title: "x", attachment: 42 }, allExist)).toThrow(/must be a local file path/);
});

test("throws when file does not exist on disk", () => {
  expect(() => validatePayload(def, { title: "x", attachment: "./nope.zip" }, () => false)).toThrow(/file not found/);
});

test("throws on unknown format", () => {
  const bad = { ...def, pages: [{ fields: [{ key: "k", actionId: "A", format: "bogus" as any }] }] };
  expect(() => validatePayload(bad, { k: "v" }, allExist)).toThrow(/unknown format "bogus"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/rohandebroy/area51/workflow-slack-new && bun test packages/cli/tests/validate.test.ts`
Expected: FAIL — `Cannot find module '../src/workflow/validate.ts'`.

- [ ] **Step 3: Write minimal implementation**

`packages/cli/src/workflow/validate.ts`:

```ts
import { existsSync } from "node:fs";
import type { WorkflowDefinition, Format } from "./definition.ts";

export class PayloadValidationError extends Error {}

const VALID_FORMATS: ReadonlySet<Format> = new Set<Format>([
  "plain", "bulletText", "bulletLink", "multiConversations", "conversation", "fileUpload",
]);

export function validatePayload(
  def: WorkflowDefinition,
  payload: Record<string, unknown>,
  fileExists: (p: string) => boolean = existsSync,
): void {
  for (let p = 0; p < def.pages.length; p++) {
    for (const field of def.pages[p]!.fields) {
      if (!VALID_FORMATS.has(field.format)) {
        throw new PayloadValidationError(`unknown format "${field.format}" for field "${field.key}" (page ${p})`);
      }
      const raw = payload[field.key];
      if (raw === undefined) {
        if (field.optional) continue;
        throw new PayloadValidationError(`missing required payload key "${field.key}" (page ${p})`);
      }
      if (field.format === "fileUpload") {
        if (typeof raw !== "string") {
          throw new PayloadValidationError(`fileUpload field "${field.key}" must be a local file path string`);
        }
        if (!fileExists(raw)) {
          throw new PayloadValidationError(`file not found for field "${field.key}": ${raw}`);
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/rohandebroy/area51/workflow-slack-new && bun test packages/cli/tests/validate.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/rohandebroy/area51/workflow-slack-new
git add -A
git commit -m "feat: pre-flight payload validation"
```

---

### Task 5: Workflow loader + sample share-extension definition

**Files:**
- Create: `packages/cli/src/workflow/loader.ts`
- Create: `workflows/share-extension.ts`
- Test: `packages/cli/tests/loader.test.ts`, `packages/cli/tests/fixtures/good-workflow.ts`, `packages/cli/tests/fixtures/bad-workflow.ts`

**Interfaces:**
- Consumes: `WorkflowDefinition` (Task 2).
- Produces:
  - class `WorkflowNotFoundError extends Error`, class `InvalidWorkflowError extends Error`.
  - `loadWorkflow(name: string, dir?: string): Promise<WorkflowDefinition>` — imports `<dir>/<name>.ts`, reads its `default` export, validates shape. `dir` defaults to the repo-root `workflows/` directory.
  - `workflows/share-extension.ts` `export default` a `WorkflowDefinition` named `"share-extension"`.

- [ ] **Step 1: Write the failing test + fixtures**

`packages/cli/tests/fixtures/good-workflow.ts`:

```ts
import type { WorkflowDefinition } from "../../src/workflow/definition.ts";
const def: WorkflowDefinition = {
  name: "good-workflow",
  trigger: { url: "https://slack/x", context: { location: "slash_command", channel_id: "C1" } },
  pages: [{ fields: [{ key: "title", actionId: "A1", format: "plain" }] }],
};
export default def;
```

`packages/cli/tests/fixtures/bad-workflow.ts`:

```ts
const def = { name: "bad-workflow", trigger: { url: "u" } }; // missing context + pages
export default def;
```

`packages/cli/tests/loader.test.ts`:

```ts
import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { loadWorkflow, WorkflowNotFoundError, InvalidWorkflowError } from "../src/workflow/loader.ts";

const FIX = resolve(import.meta.dir, "fixtures");

test("loads a definition by name from a directory", async () => {
  const def = await loadWorkflow("good-workflow", FIX);
  expect(def.name).toBe("good-workflow");
  expect(def.pages[0]!.fields[0]!.key).toBe("title");
});

test("throws WorkflowNotFoundError for unknown name", async () => {
  await expect(loadWorkflow("does-not-exist", FIX)).rejects.toBeInstanceOf(WorkflowNotFoundError);
});

test("throws InvalidWorkflowError for malformed definition", async () => {
  await expect(loadWorkflow("bad-workflow", FIX)).rejects.toBeInstanceOf(InvalidWorkflowError);
});

test("loads the real share-extension sample", async () => {
  const def = await loadWorkflow("share-extension");
  expect(def.name).toBe("share-extension");
  expect(def.pages.length).toBeGreaterThan(0);
  expect(def.pages[0]!.fields.some((f) => f.format === "fileUpload")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/rohandebroy/area51/workflow-slack-new && bun test packages/cli/tests/loader.test.ts`
Expected: FAIL — `Cannot find module '../src/workflow/loader.ts'`.

- [ ] **Step 3: Write the loader**

`packages/cli/src/workflow/loader.ts`:

```ts
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkflowDefinition } from "./definition.ts";

export class WorkflowNotFoundError extends Error {}
export class InvalidWorkflowError extends Error {}

// loader.ts lives at packages/cli/src/workflow/ -> repo root is four levels up.
const DEFAULT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../workflows");

function assertValid(def: unknown, name: string): asserts def is WorkflowDefinition {
  const d = def as Partial<WorkflowDefinition> | undefined;
  if (!d || typeof d !== "object") throw new InvalidWorkflowError(`workflow "${name}" has no default export object`);
  if (typeof d.name !== "string") throw new InvalidWorkflowError(`workflow "${name}" missing string "name"`);
  if (!d.trigger || typeof d.trigger.url !== "string" || !d.trigger.context || typeof d.trigger.context.channel_id !== "string") {
    throw new InvalidWorkflowError(`workflow "${name}" has an invalid "trigger"`);
  }
  if (!Array.isArray(d.pages) || d.pages.length === 0) {
    throw new InvalidWorkflowError(`workflow "${name}" must have at least one page`);
  }
  for (const page of d.pages) {
    if (!Array.isArray(page.fields)) throw new InvalidWorkflowError(`workflow "${name}" has a page without "fields"`);
    for (const f of page.fields) {
      if (typeof f.key !== "string" || typeof f.actionId !== "string" || typeof f.format !== "string") {
        throw new InvalidWorkflowError(`workflow "${name}" has a field missing key/actionId/format`);
      }
    }
  }
}

export async function loadWorkflow(name: string, dir: string = DEFAULT_DIR): Promise<WorkflowDefinition> {
  const file = resolve(dir, `${name}.ts`);
  if (!existsSync(file)) throw new WorkflowNotFoundError(`no workflow "${name}" at ${file}`);
  const mod = (await import(file)) as { default?: unknown };
  assertValid(mod.default, name);
  return mod.default;
}
```

- [ ] **Step 4: Write the sample share-extension definition**

`workflows/share-extension.ts`:

```ts
import type { WorkflowDefinition } from "../packages/cli/src/workflow/definition.ts";

// action_ids are baked into the Slack workflow and stay stable across runs.
// Ported from ../slack-workflow share-extension/build-state.ts ACTION_IDS.
const def: WorkflowDefinition = {
  name: "share-extension",
  trigger: {
    url: "https://slack.com/shortcuts/Ft0B2R4FXXX/df7425a243d29786e59cb0f897725391",
    context: { location: "slash_command", channel_id: "C09HRTA7XXX" },
  },
  pages: [
    {
      fields: [
        { key: "extensionVersion", actionId: "289bff52-71a6-44f9-8062-4d5a024b0f4c", format: "plain" },
        { key: "engineVersion", actionId: "43c596d0-6ce1-4449-b77a-2e172f45738c", format: "plain" },
        { key: "a11yEngineThread", actionId: "dc0ae4f0-d2bd-4a1b-a63d-613b630ce535", format: "plain", optional: true },
        { key: "a11yExtensionCoreVersion", actionId: "8c44e648-62ad-440c-ade8-0b8be29f92aa", format: "plain", optional: true },
        { key: "jiraLink", actionId: "f2cbee19-6cc2-4f9d-9e2a-0c8f1f719625", format: "bulletLink" },
        { key: "prLink", actionId: "fc6ea757-625e-48bc-b13a-3e23bc1e9136", format: "bulletLink" },
        { key: "changelog", actionId: "8b8d3592-1a87-4988-90e9-336db8fb13b4", format: "bulletText" },
        { key: "whomToTag", actionId: "43f7fb13-e388-40d5-a329-5c4e852c5e89", format: "multiConversations" },
        { key: "notes", actionId: "64ed8fa1-f7a2-49d0-bba9-f7950e735436", format: "bulletText", optional: true },
        { key: "attachment", actionId: "17c5a750-7960-4498-8cef-5f8f7301346b", format: "fileUpload" },
        { key: "reviewedBy", actionId: "e488ec32-7cd2-43e1-b2ea-3915b916c514", format: "conversation" },
      ],
    },
  ],
};

export default def;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/rohandebroy/area51/workflow-slack-new && bun test packages/cli/tests/loader.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 6: Commit**

```bash
cd /Users/rohandebroy/area51/workflow-slack-new
git add -A
git commit -m "feat: workflow loader and sample share-extension definition"
```

---

### Task 6: Multi-page runner

**Files:**
- Create: `packages/cli/src/workflow/runner.ts`
- Test: `packages/cli/tests/runner.test.ts`

**Interfaces:**
- Consumes: `WorkflowDefinition` (Task 2); `buildState`, `blockIdMap` (Task 3); core `triggersTrip`, `uploadFile`, `viewsSubmit`, `waitFor` and types `Session`, `EventStream`, `SlackEvent` (Task 1).
- Produces:
  - `interface RunInput { def: WorkflowDefinition; payload: Record<string, unknown>; session: Session; stream: EventStream; readFile?: (path: string) => Promise<Uint8Array>; timeoutMs?: number; deps?: RunDeps }`.
  - `interface RunOutput { functionExecutionId: string; triggerExecutionId: string; pagesSubmitted: number }`.
  - `runWorkflow(input: RunInput): Promise<RunOutput>`.

- [ ] **Step 1: Write the failing test**

`packages/cli/tests/runner.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/rohandebroy/area51/workflow-slack-new && bun test packages/cli/tests/runner.test.ts`
Expected: FAIL — `Cannot find module '../src/workflow/runner.ts'`.

- [ ] **Step 3: Write the runner**

`packages/cli/src/workflow/runner.ts`:

```ts
import { readFile as fsReadFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Session, EventStream, SlackEvent } from "@slack-automate/core";
import {
  triggersTrip as _triggersTrip,
  uploadFile as _uploadFile,
  viewsSubmit as _viewsSubmit,
  waitFor as _waitFor,
} from "@slack-automate/core";
import type { WorkflowDefinition, TriggerContext } from "./definition.ts";
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

function resolveContext(def: WorkflowDefinition, payload: Record<string, unknown>): TriggerContext {
  if (def.buildContext) return def.buildContext(payload);
  const channel = payload._channel;
  if (typeof channel === "string") return { ...def.trigger.context, channel_id: channel };
  return def.trigger.context;
}

export async function runWorkflow(input: RunInput): Promise<RunOutput> {
  const d = input.deps ?? DEFAULT_DEPS;
  const readFile = input.readFile ?? (async (p: string) => new Uint8Array(await fsReadFile(p)));
  const timeout = input.timeoutMs ?? 15_000;
  const { def, payload, session, stream } = input;

  // Subscribe to the FIRST view_opened (matched by client_token) BEFORE firing the
  // trip — the WSS frame can arrive before the HTTP response, so subscribing after
  // would race. waitFor subscribes synchronously when called.
  const client_token = `web-${Date.now()}`;
  let viewPromise: Promise<ViewOpened> = d.waitFor(
    stream,
    (e: SlackEvent): e is ViewOpened => e.type === "view_opened" && e.client_token === client_token,
    { timeout },
  );

  const trip = await d.triggersTrip(session, {
    url: def.trigger.url,
    context: resolveContext(def, payload),
    run_precheck: true,
    client_token,
  });

  let pagesSubmitted = 0;
  for (let p = 0; p < def.pages.length; p++) {
    let view: ViewOpened;
    try {
      view = await viewPromise;
    } catch (err) {
      throw new Error(`runWorkflow: page ${p} view never opened (${(err as Error).message})`);
    }
    const page = def.pages[p]!;
    const blockIds = blockIdMap(view.view?.blocks);

    // Upload any fileUpload fields present on this page, keyed by field.key.
    const uploadedIds = new Map<string, string>();
    for (const field of page.fields) {
      if (field.format !== "fileUpload") continue;
      const path = payload[field.key];
      if (typeof path !== "string") continue; // optional + omitted (validated earlier otherwise)
      const bytes = await readFile(path);
      const uploaded = await d.uploadFile(session, { bytes, filename: basename(path) });
      uploadedIds.set(field.key, uploaded.id);
    }

    const state = buildState(page, payload, blockIds, uploadedIds, def);

    // If more pages remain, subscribe to the next view_opened BEFORE submitting,
    // so the pushed view's frame isn't missed. Swallow it if we end up not advancing.
    const moreToCome = p < def.pages.length - 1;
    const nextPromise: Promise<ViewOpened> | undefined = moreToCome
      ? d.waitFor(stream, (e: SlackEvent): e is ViewOpened => e.type === "view_opened", { timeout })
      : undefined;

    const resp = await d.viewsSubmit(session, { view_id: view.view_id, state });
    pagesSubmitted++;

    const advance = def.shouldContinue
      ? def.shouldContinue(resp)
      : resp.response_action === "push" || resp.response_action === "update";

    if (advance && nextPromise) {
      viewPromise = nextPromise;
      continue;
    }
    if (nextPromise) void nextPromise.catch(() => {}); // discard unused subscription
    break;
  }

  return {
    functionExecutionId: trip.function_execution_id,
    triggerExecutionId: trip.trigger_execution_id,
    pagesSubmitted,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/rohandebroy/area51/workflow-slack-new && bun test packages/cli/tests/runner.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/rohandebroy/area51/workflow-slack-new
git add -A
git commit -m "feat: multi-page workflow runner with per-page file upload + linking"
```

---

### Task 7: CLI wiring (`trigger` + `launch` commands, entry point)

**Files:**
- Create: `packages/cli/src/commands/launch.ts`
- Create: `packages/cli/src/commands/trigger.ts`
- Create: `packages/cli/src/index.ts`
- Test: `packages/cli/tests/trigger-payload.test.ts`

**Interfaces:**
- Consumes: `loadWorkflow` (Task 5), `validatePayload` (Task 4), `runWorkflow` (Task 6), core `attach`, `createStream` (Task 1).
- Produces:
  - `launchCommand(opts: { port: number }): void`.
  - `parsePayload(opts: { payload?: string; payloadFile?: string }): Record<string, unknown>` — exported for testing; throws on neither/both supplied or invalid JSON.
  - `triggerCommand(name: string, opts: TriggerOpts): Promise<void>`.
  - `run(argv: string[]): void` — Commander entry with `launch` and `trigger` subcommands.

- [ ] **Step 1: Write the failing test (payload parsing)**

`packages/cli/tests/trigger-payload.test.ts`:

```ts
import { test, expect } from "bun:test";
import { parsePayload } from "../src/commands/trigger.ts";

test("parses inline JSON payload", () => {
  expect(parsePayload({ payload: '{"a":1,"b":"x"}' })).toEqual({ a: 1, b: "x" });
});

test("throws when neither --payload nor --payload-file given", () => {
  expect(() => parsePayload({})).toThrow(/exactly one of --payload or --payload-file/);
});

test("throws when both given", () => {
  expect(() => parsePayload({ payload: "{}", payloadFile: "p.json" })).toThrow(/exactly one of/);
});

test("throws on invalid JSON", () => {
  expect(() => parsePayload({ payload: "{not json" })).toThrow(/invalid JSON/);
});

test("throws when payload is not a JSON object", () => {
  expect(() => parsePayload({ payload: "[1,2,3]" })).toThrow(/must be a JSON object/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/rohandebroy/area51/workflow-slack-new && bun test packages/cli/tests/trigger-payload.test.ts`
Expected: FAIL — `Cannot find module '../src/commands/trigger.ts'`.

- [ ] **Step 3: Write the launch command**

`packages/cli/src/commands/launch.ts` (ported from reference):

```ts
import { spawn } from "node:child_process";

const SLACK_BIN = "/Applications/Slack.app/Contents/MacOS/Slack";

export function launchCommand(opts: { port: number }): void {
  const child = spawn(SLACK_BIN, [`--remote-debugging-port=${opts.port}`], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  console.log(`launched Slack with --remote-debugging-port=${opts.port}`);
}
```

- [ ] **Step 4: Write the trigger command**

`packages/cli/src/commands/trigger.ts`:

```ts
import { readFileSync } from "node:fs";
import { attach, createStream } from "@slack-automate/core";
import { loadWorkflow } from "../workflow/loader.ts";
import { validatePayload } from "../workflow/validate.ts";
import { runWorkflow } from "../workflow/runner.ts";

export interface TriggerOpts {
  payload?: string;
  payloadFile?: string;
  port?: string;
  dryRun?: boolean;
}

export function parsePayload(opts: { payload?: string; payloadFile?: string }): Record<string, unknown> {
  const hasInline = typeof opts.payload === "string";
  const hasFile = typeof opts.payloadFile === "string";
  if (hasInline === hasFile) {
    throw new Error("provide exactly one of --payload or --payload-file");
  }
  const text = hasInline ? opts.payload! : readFileSync(opts.payloadFile!, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`invalid JSON payload: ${(e as Error).message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("payload must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export async function triggerCommand(name: string, opts: TriggerOpts): Promise<void> {
  const payload = parsePayload(opts);
  const def = await loadWorkflow(name);
  validatePayload(def, payload);

  if (opts.dryRun) {
    console.log(`[dry-run] workflow "${def.name}"`);
    console.log(`[dry-run] trigger url: ${def.trigger.url}`);
    console.log(`[dry-run] context: ${JSON.stringify(def.buildContext ? def.buildContext(payload) : def.trigger.context)}`);
    def.pages.forEach((page, p) => {
      console.log(`[dry-run] page ${p}:`);
      for (const f of page.fields) {
        const present = payload[f.key] !== undefined;
        if (!present && f.optional) continue;
        const note = f.format === "fileUpload" ? ` (upload local file: ${String(payload[f.key])})` : "";
        console.log(`[dry-run]   ${f.key} [${f.format}] = ${JSON.stringify(payload[f.key])}${note}`);
      }
    });
    console.log("[dry-run] no Slack calls made");
    return;
  }

  const session = await attach({ port: Number(opts.port ?? "9222") });
  try {
    const stream = createStream(session);
    const out = await runWorkflow({ def, payload, session, stream });
    console.log(`triggered "${name}": function_execution_id=${out.functionExecutionId}, pages submitted=${out.pagesSubmitted}`);
  } finally {
    await session.close();
  }
}
```

- [ ] **Step 5: Write the entry point**

`packages/cli/src/index.ts`:

```ts
import { Command } from "commander";
import { launchCommand } from "./commands/launch.ts";
import { triggerCommand } from "./commands/trigger.ts";

export function run(argv: string[]): void {
  const program = new Command()
    .name("slack-cli")
    .description("Trigger repo-defined Slack workflows via the logged-in desktop app (CDP)")
    .version("0.0.0");

  program
    .command("launch")
    .description("Launch Slack with the CDP debug port enabled")
    .option("-p, --port <port>", "debug port", "9222")
    .action((opts) => launchCommand({ port: Number(opts.port) }));

  program
    .command("trigger")
    .description("Trigger a workflow defined in workflows/ with a JSON payload")
    .argument("<name>", "workflow name (file workflows/<name>.ts)")
    .option("--payload <json>", "inline JSON payload")
    .option("--payload-file <path>", "path to a JSON payload file")
    .option("-p, --port <port>", "CDP debug port", "9222")
    .option("--dry-run", "validate and print the resolved payload without calling Slack")
    .action((name, opts) => triggerCommand(name, opts));

  program.parseAsync(argv).catch((err) => {
    console.error(err.message ?? String(err));
    process.exit(1);
  });
}
```

- [ ] **Step 6: Run the payload test to verify it passes**

Run: `cd /Users/rohandebroy/area51/workflow-slack-new && bun test packages/cli/tests/trigger-payload.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 7: Verify the dry-run path end-to-end (no Slack)**

Run:
```bash
cd /Users/rohandebroy/area51/workflow-slack-new
touch /tmp/build.zip
bun packages/cli/bin/slack-cli trigger share-extension --dry-run --payload '{"extensionVersion":"1.2.3","engineVersion":"4.5.6","jiraLink":"https://jira/x","prLink":"https://gh/pr/1","changelog":"did things","whomToTag":["U1"],"reviewedBy":"U9","attachment":"/tmp/build.zip"}'
```
Expected: prints `[dry-run] workflow "share-extension"`, the trigger url, context, page 0 fields (including `attachment [fileUpload] = "/tmp/build.zip" (upload local file: /tmp/build.zip)`), and `[dry-run] no Slack calls made`. Exit code 0. No Slack connection attempted.

- [ ] **Step 8: Full typecheck + test suite**

Run: `cd /Users/rohandebroy/area51/workflow-slack-new && bun run typecheck && bun test`
Expected: typecheck PASS; all suites (core ports + cli) PASS.

- [ ] **Step 9: Commit**

```bash
cd /Users/rohandebroy/area51/workflow-slack-new
git add -A
git commit -m "feat: slack-cli trigger + launch commands and entry point"
```

---

## Self-Review

**Spec coverage:**
- Goal 1 (repo-defined, multi-page workflows): Task 2 (types), Task 5 (loader + sample), Task 6 (multi-page runner). ✓
- Goal 2 (trigger by name with JSON payload): Task 7 (`trigger` command, `parsePayload`). ✓
- Goal 3 (file upload + linking): Task 3 (`fileUpload` -> `file_input` linking), Task 6 (per-page upload via ported `uploadFile`). ✓
- Core reuse / port: Task 1. ✓
- Hybrid definition (data + optional hooks): Task 2 (`formatValue`/`buildContext`/`shouldContinue`), exercised in Tasks 3 & 6. ✓
- Payload validation before any Slack call: Task 4, wired in Task 7. ✓
- Dry-run: Task 7 Step 7. ✓
- Testing plan (build-state, runner 1- & 2-page, loader, payload): Tasks 3–7. ✓
- Never trigger real Slack: all tests mock deps; only manual dry-run runs the binary. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". All code blocks complete.

**Type consistency:** `buildState(page, payload, blockIds, uploadedIds, hooks?)` signature identical in Task 3 (definition + test) and Task 6 (caller passes `def` as the `Pick<…,"formatValue">` hooks arg — `WorkflowDefinition` structurally satisfies it). `blockIdMap` argument shape matches the `view.view?.blocks` element shape from core's `view_opened` event (Task 1 Interfaces). `RunOutput` / `RunInput` names consistent between Task 6 definition and Task 7 caller. `parsePayload` / `triggerCommand` / `launchCommand` / `run` names consistent between Task 7 and `index.ts`. `loadWorkflow(name, dir?)`, `validatePayload(def, payload, fileExists?)` signatures consistent across producer and consumer tasks.
