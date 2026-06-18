import { setTimeout as sleep } from "node:timers/promises";
import { restartCommand } from "./restart.ts";

/** True if the CDP debug port is reachable AND has a Slack (app.slack.com) target. */
async function isDebugActive(port: number, urlMatch = "app.slack.com"): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${port}/json`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const targets = (await res.json()) as Array<{ url?: string }>;
    return Array.isArray(targets) && targets.some((t) => typeof t.url === "string" && t.url.includes(urlMatch));
  } catch {
    return false; // port closed / not listening / not Slack
  }
}

async function waitForDebug(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isDebugActive(port)) return true;
    await sleep(500);
  }
  return false;
}

/**
 * Ensure Slack is running with the CDP debug port enabled. If it already is, do
 * nothing (no restart). Otherwise (re)start it with the flag and wait until the
 * port is reachable.
 */
export async function ensureDebugCommand(opts: { port: number }): Promise<void> {
  if (await isDebugActive(opts.port)) {
    console.log(`Slack already in debug mode on port ${opts.port} — nothing to do`);
    return;
  }
  console.log(`Slack not in debug mode — (re)starting with --remote-debugging-port=${opts.port}`);
  await restartCommand({ port: opts.port });
  if (await waitForDebug(opts.port, 30_000)) {
    console.log(`Slack debug port ${opts.port} is ready`);
  } else {
    console.warn(`Slack relaunched but debug port ${opts.port} not reachable yet — give it a moment and retry`);
  }
}
