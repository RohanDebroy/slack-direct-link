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
