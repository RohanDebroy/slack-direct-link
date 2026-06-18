import { Command } from "commander";
import { launchCommand } from "./commands/launch.ts";
import { restartCommand } from "./commands/restart.ts";
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
    .command("restart")
    .description("Quit the running Slack and relaunch it with the CDP debug port enabled")
    .option("-p, --port <port>", "debug port", "9222")
    .action((opts) => restartCommand({ port: Number(opts.port) }));

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
