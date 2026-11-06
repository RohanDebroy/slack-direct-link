import { attach, reactionsAdd, reactionsRemove } from "@slack-automate/core";

/** Add an emoji reaction to a message, or take it off again with `remove`. */
export async function reactCommand(
  channel: string,
  ts: string,
  emoji: string,
  opts: { port: number; remove?: boolean },
): Promise<void> {
  const session = await attach({ port: opts.port });
  try {
    const input = { channel, timestamp: ts, name: emoji.replace(/^:|:$/g, "") };
    await (opts.remove ? reactionsRemove : reactionsAdd)(session, input);
  } finally {
    await session.close();
  }
}
