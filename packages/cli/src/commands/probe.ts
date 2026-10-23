import { attach, type WssFrame } from "@slack-automate/core";

export type FrameDir = "recv" | "sent";

/**
 * One NDJSON line per WebSocket frame. `payload` is the frame's payloadData exactly as
 * CDP delivered it (text for opcode 1, base64 for binary opcode 2); JSON-encoding it keeps
 * any embedded newlines escaped so every frame is exactly one line.
 */
export function frameLine(dir: FrameDir, frame: WssFrame, time = Date.now()): string {
  return JSON.stringify({
    time,
    dir,
    requestId: frame.requestId,
    opcode: frame.response.opcode,
    payload: frame.response.payloadData,
  }) + "\n";
}

/**
 * Stream every WebSocket frame Slack sends/receives to stdout until interrupted or Slack
 * disconnects. stdout carries only frame lines; status goes to stderr.
 */
export async function probeCommand(opts: { port: number }): Promise<void> {
  const session = await attach({ port: opts.port });
  session.on("Network.webSocketFrameReceived", (f) => process.stdout.write(frameLine("recv", f)));
  session.on("Network.webSocketFrameSent", (f) => process.stdout.write(frameLine("sent", f)));
  console.error(`probe: streaming Slack WebSocket frames from port ${opts.port} (Ctrl-C to stop)`);
}
