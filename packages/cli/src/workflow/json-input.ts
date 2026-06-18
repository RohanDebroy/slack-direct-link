import { readFileSync } from "node:fs";

/**
 * Read a JSON object from exactly one of an inline string or a file path.
 * Used for both the workflow definition and the payload on the `run` command,
 * and for the payload on `trigger`.
 */
export function readJsonObject(
  inline: string | undefined,
  file: string | undefined,
  flags: { inlineFlag: string; fileFlag: string },
): Record<string, unknown> {
  const hasInline = typeof inline === "string";
  const hasFile = typeof file === "string";
  if (hasInline === hasFile) {
    throw new Error(`provide exactly one of ${flags.inlineFlag} or ${flags.fileFlag}`);
  }
  const source = hasInline ? flags.inlineFlag : flags.fileFlag;
  const text = hasInline ? inline! : readFileSync(file!, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`invalid JSON for ${source}: ${(e as Error).message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${source} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}
