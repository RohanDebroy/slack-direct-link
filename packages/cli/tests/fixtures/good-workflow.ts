import type { WorkflowDefinition } from "../../src/workflow/definition.ts";
const def: WorkflowDefinition = {
  name: "good-workflow",
  trigger: { url: "https://slack/x", context: { location: "slash_command", channel_id: "C1" } },
  pages: [{ fields: [{ key: "title", actionId: "A1", format: "plain" }] }],
};
export default def;
