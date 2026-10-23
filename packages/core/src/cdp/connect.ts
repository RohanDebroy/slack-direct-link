import CDP from "chrome-remote-interface";
import type { Session, ConnectOptions, WssFrame } from "./types.ts";

export class NoSlackTargetError extends Error {
  constructor(urlMatch: string) {
    super(`No CDP target matched url substring "${urlMatch}". Is Slack running with --remote-debugging-port=9222?`);
  }
}

export class CdpUnreachableError extends Error {
  constructor(port: number) {
    super(`Couldn't reach Slack on localhost:${port}. Run \`slack-cli launch\` first.`);
  }
}

interface CdpTarget { url: string; webSocketDebuggerUrl: string; }

export function findTarget(targets: CdpTarget[], urlMatch: string): CdpTarget {
  const t = targets.find((x) => x.url.includes(urlMatch));
  if (!t) throw new NoSlackTargetError(urlMatch);
  return t;
}

export async function attach(opts: ConnectOptions): Promise<Session> {
  const port = opts.port;
  const urlMatch = opts.urlMatch ?? "app.slack.com";

  let targets: CdpTarget[];
  try {
    targets = (await CDP.List({ port })) as CdpTarget[];
  } catch {
    throw new CdpUnreachableError(port);
  }

  const target = findTarget(targets, urlMatch);
  const client = await CDP({ port, target: target.webSocketDebuggerUrl });
  await client.Runtime.enable();
  // Cap post data mirrored into requestWillBeSent: unset, Chrome copies every request body
  // (e.g. a 25 MB upload -> ~60 MB of event text) through Slack's processes to us. We only
  // consume WebSocket frames, which this limit does not affect.
  await client.Network.enable({ maxPostDataSize: 1024 });

  return {
    async evaluate<T>(expression: string): Promise<T> {
      const r = await client.Runtime.evaluate({
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) {
        throw new Error(`renderer threw: ${r.exceptionDetails.text}`);
      }
      return r.result.value as T;
    },
    on(event, handler) {
      // The typed event-callback API returns an unsubscribe function.
      const subscribe = event === "Network.webSocketFrameSent"
        ? client.Network.webSocketFrameSent
        : client.Network.webSocketFrameReceived;
      const unsubscribe = subscribe((params) => handler(params as WssFrame));
      return () => {
        unsubscribe();
      };
    },
    async close() {
      await client.close();
    },
  };
}
