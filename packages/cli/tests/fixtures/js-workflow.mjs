export default {
  name: "js-workflow",
  trigger: { url: "https://slack/js", context: { location: "slash_command", channel_id: "C2" } },
  pages: [{ fields: [{ key: "title", actionId: "A1", format: "plain" }] }],
};
