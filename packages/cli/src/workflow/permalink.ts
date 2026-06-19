export interface ParsedMessageRef {
  channel: string;
  ts: string;
}

export class PermalinkParseError extends Error {}

// Slack "Copy link" URLs look like .../archives/<C...>/p<digits>[?query].
const ARCHIVES_RE = /\/archives\/([A-Z0-9]+)\/p(\d+)/;

/** Parse a Slack message permalink into { channel, ts } (decimal inserted 6 digits from the end). */
export function parsePermalink(url: string): ParsedMessageRef {
  const m = ARCHIVES_RE.exec(url);
  if (!m) throw new PermalinkParseError(`not a Slack message permalink: ${url}`);
  const digits = m[2]!;
  if (digits.length < 7) throw new PermalinkParseError(`malformed message id in permalink: ${url}`);
  return { channel: m[1]!, ts: `${digits.slice(0, -6)}.${digits.slice(-6)}` };
}

/** Resolve the reacted-message ref from a payload: prefer `_message` (permalink), else `_channel`+`_ts`. */
export function resolveMessageRef(payload: Record<string, unknown>): ParsedMessageRef {
  const link = payload._message;
  if (typeof link === "string") return parsePermalink(link);
  const channel = payload._channel;
  const ts = payload._ts;
  if (typeof channel === "string" && typeof ts === "string") return { channel, ts };
  throw new PermalinkParseError('reaction trigger requires "_message" (permalink) or "_channel"+"_ts" in the payload');
}
