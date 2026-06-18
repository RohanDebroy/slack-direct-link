import type { WorkflowDefinition } from "../packages/cli/src/workflow/definition.ts";

// Sample workflow definition (placeholder).
// Real workflow definitions are intentionally not included in this repository.
const def: WorkflowDefinition = {
  name: "sample-workflow-1",
  description: "A sample workflow definition.",
  trigger: {
    url: "https://slack.com/shortcuts/EXAMPLE/00000000000000000000000000000000",
    context: { location: "slash_command", channel_id: "C0000000000" },
  },
  pages: [
    {
      fields: [
        {
          key: "exampleField",
          actionId: "00000000-0000-0000-0000-000000000000",
          format: "plain",
        },
      ],
    },
  ],
};

export default def;
