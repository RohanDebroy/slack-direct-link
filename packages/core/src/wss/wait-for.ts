import type { EventStream } from "./stream.ts";
import type { SlackEvent } from "./events.ts";

export class WaitForTimeoutError extends Error {
  constructor(ms: number) { super(`waitFor: no matching event in ${ms}ms`); }
}

export async function waitFor<E extends SlackEvent = SlackEvent>(
  stream: EventStream,
  predicate: (e: SlackEvent) => e is E,
  opts: { timeout: number },
): Promise<E>;
export async function waitFor(
  stream: EventStream,
  predicate: (e: SlackEvent) => boolean,
  opts: { timeout: number },
): Promise<SlackEvent>;
export async function waitFor(
  stream: EventStream,
  predicate: (e: SlackEvent) => boolean,
  opts: { timeout: number },
): Promise<SlackEvent> {
  return new Promise((resolve, reject) => {
    const unsub = stream.subscribe((e) => {
      if (predicate(e)) { unsub(); clearTimeout(timer); resolve(e); }
    });
    const timer = setTimeout(() => { unsub(); reject(new WaitForTimeoutError(opts.timeout)); }, opts.timeout);
  });
}
