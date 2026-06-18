import type { Session } from "../cdp/types.ts";
import { parseFrame, type SlackEvent } from "./events.ts";

export interface EventStream {
  subscribe(handler: (e: SlackEvent) => void): () => void;
}

export function createStream(session: Session): EventStream {
  const handlers = new Set<(e: SlackEvent) => void>();
  session.on("Network.webSocketFrameReceived", (frame) => {
    const e = parseFrame(frame);
    if (e) for (const h of handlers) h(e);
  });
  return {
    subscribe(h) { handlers.add(h); return () => handlers.delete(h); },
  };
}
