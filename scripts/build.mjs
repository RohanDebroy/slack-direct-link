// Build the CLI to plain JS that runs on any Node (no bun, no experimental flags).
//   node scripts/build.mjs
// Produces:
//   dist/slack-cli.mjs        — bundled CLI (shebang #!/usr/bin/env node)
//   dist/workflows/*.mjs      — each workflows/*.ts compiled to ESM (loaded at runtime)
import { build } from "esbuild";
import { readdirSync, mkdirSync, chmodSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
mkdirSync(resolve(dist, "workflows"), { recursive: true });

// 1. Bundle the CLI (deps included) into one Node-runnable ESM file.
await build({
  entryPoints: [resolve(root, "packages/cli/src/main.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: resolve(dist, "slack-cli.mjs"),
  // ESM bundle of CJS deps needs a real `require` (for `require("node:events")` etc.)
  // and __dirname/__filename shims for any dep that uses them.
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as __createRequire } from \"node:module\";",
      "import { fileURLToPath as __fileURLToPath } from \"node:url\";",
      "import { dirname as __pathDirname } from \"node:path\";",
      "const require = __createRequire(import.meta.url);",
      "const __filename = __fileURLToPath(import.meta.url);",
      "const __dirname = __pathDirname(__filename);",
    ].join("\n"),
  },
  logLevel: "info",
});
chmodSync(resolve(dist, "slack-cli.mjs"), 0o755);

// 2. Compile each workflow module to ESM (type-only imports are erased). Not bundled —
//    the loader imports these at runtime from dist/workflows/<name>.mjs.
const wfDir = resolve(root, "workflows");
const wfEntries = readdirSync(wfDir)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => resolve(wfDir, f));
if (wfEntries.length) {
  await build({
    entryPoints: wfEntries,
    outdir: resolve(dist, "workflows"),
    platform: "node",
    format: "esm",
    target: "node18",
    outExtension: { ".js": ".mjs" },
    bundle: false,
    logLevel: "info",
  });
}

console.log(`\nbuilt: dist/slack-cli.mjs + dist/workflows/ (${wfEntries.length} workflow(s))`);
