import { Command } from "commander";
import { launchCommand } from "./commands/launch.ts";
import { restartCommand } from "./commands/restart.ts";
import { ensureDebugCommand } from "./commands/ensure.ts";
import { extractCommand } from "./commands/extract.ts";
import { triggerCommand } from "./commands/trigger.ts";
import { runCommand } from "./commands/run.ts";
import { listCommand } from "./commands/list.ts";

export function run(argv: string[]): void {
  const AUTHOR = "Rohan Debroy";
  const AUTHOR_URL = "https://github.com/rohandebroy";

  const program = new Command()
    .name("slack-cli")
    .description("Trigger repo-defined Slack workflows via the logged-in desktop app (CDP)")
    .version(`0.0.0 — hand-wired to your Slack by ${AUTHOR} 🪄  ${AUTHOR_URL}`)
    .addHelpText(
      "afterAll",
      [
        "",
        `🤖 Built by ${AUTHOR}, who got tired of clicking Slack modals by hand.`,
        `   No bots were harmed (and no OAuth was consented to) in the making of this CLI.`,
        `   ${AUTHOR_URL}`,
        "",
      ].join("\n"),
    );

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
    .command("ensure-debug")
    .description("Ensure Slack is running with the CDP debug port; skip the restart if it already is")
    .option("-p, --port <port>", "debug port", "9222")
    .action((opts) => ensureDebugCommand({ port: Number(opts.port) }));

  program
    .command("extract")
    .description("Trip a workflow trigger, capture the modal, and scaffold a workflow definition (does not submit)")
    .argument("<trigger-url>", "the Slack shortcut/trigger URL to trip")
    .requiredOption("--name <name>", "name for the generated workflow (file workflows/<name>.ts)")
    .requiredOption("--channel <id>", "channel id to trip the trigger from")
    .option("-p, --port <port>", "CDP debug port", "9222")
    .option("--out <path>", "output path (default workflows/<name>.ts)")
    .action((url, opts) => extractCommand(url, opts));

  program
    .command("list")
    .description("List all workflows in workflows/ with identifying metadata")
    .option("--json", "output as JSON")
    .action((opts) => listCommand(opts));

  program
    .command("trigger")
    .description("Trigger a workflow defined in workflows/ with a JSON payload")
    .argument("<name>", "workflow name (file workflows/<name>.ts)")
    .option("--payload <json>", "inline JSON payload")
    .option("--payload-file <path>", "path to a JSON payload file")
    .option("-p, --port <port>", "CDP debug port", "9222")
    .option("--dry-run", "validate and print the resolved payload without calling Slack")
    .action((name, opts) => triggerCommand(name, opts));

  program
    .command("run")
    .description("Trigger a workflow passed inline as JSON (definition + values supplied at runtime, not from workflows/)")
    .option("--workflow <json>", "inline workflow definition JSON")
    .option("--workflow-file <path>", "path to a workflow definition JSON file")
    .option("--payload <json>", "inline JSON payload")
    .option("--payload-file <path>", "path to a JSON payload file")
    .option("-p, --port <port>", "CDP debug port", "9222")
    .option("--dry-run", "validate and print the resolved payload without calling Slack")
    .action((opts) => runCommand(opts));

  program.parseAsync(argv).catch((err) => {
    console.error(err.message ?? String(err));
    process.exit(1);
  });
}
