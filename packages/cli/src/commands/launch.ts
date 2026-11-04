import { spawn } from "node:child_process";

const SLACK_BIN = "/Applications/Slack.app/Contents/MacOS/Slack";

// Slack 4.53+ refuses --remote-debugging-port on its default profile, so point it
// at a separate profile dir (override with SLACK_DEBUG_PROFILE).
const DEBUG_PROFILE =
  process.env.SLACK_DEBUG_PROFILE ||
  `${process.env.HOME}/Library/Application Support/Slack-debug`;

export function launchCommand(opts: { port: number }): void {
  const child = spawn(SLACK_BIN, [`--remote-debugging-port=${opts.port}`, `--user-data-dir=${DEBUG_PROFILE}`], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  console.log(`launched Slack with --remote-debugging-port=${opts.port}`);
}
