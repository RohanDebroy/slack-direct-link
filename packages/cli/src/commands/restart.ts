import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const SLACK_BIN = "/Applications/Slack.app/Contents/MacOS/Slack";

/** True while a Slack process is running. */
function slackRunning(): boolean {
  try {
    execFileSync("pgrep", ["-x", "Slack"], { stdio: "ignore" });
    return true;
  } catch {
    return false; // pgrep exits non-zero when nothing matches
  }
}

/**
 * Restart Slack with the CDP debug port enabled.
 *
 * Slack is single-instance: relaunching while it's already running just focuses
 * the existing window WITHOUT the debug flag. So we must quit the running app and
 * wait for it to fully exit before relaunching with --remote-debugging-port.
 */
export async function restartCommand(opts: { port: number }): Promise<void> {
  if (slackRunning()) {
    // Ask Slack to quit gracefully (lets it save state); fall back to SIGTERM.
    try {
      execFileSync("osascript", ["-e", 'quit app "Slack"'], { stdio: "ignore" });
    } catch {
      try {
        execFileSync("pkill", ["-x", "Slack"], { stdio: "ignore" });
      } catch {
        // already gone between the check and here
      }
    }

    // Wait (up to ~10s) for the process to actually exit before relaunching.
    for (let i = 0; i < 50 && slackRunning(); i++) await sleep(200);
    if (slackRunning()) {
      try {
        execFileSync("pkill", ["-9", "-x", "Slack"], { stdio: "ignore" });
      } catch {
        // ignore
      }
      await sleep(500);
    }
  }

  const child = spawn(SLACK_BIN, [`--remote-debugging-port=${opts.port}`], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  console.log(`restarted Slack with --remote-debugging-port=${opts.port}`);
}
