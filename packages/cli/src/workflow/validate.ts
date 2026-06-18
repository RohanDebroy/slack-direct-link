import { existsSync } from "node:fs";
import type { WorkflowDefinition, Format } from "./definition.ts";

export class PayloadValidationError extends Error {}

const VALID_FORMATS: ReadonlySet<Format> = new Set<Format>([
  "plain", "bulletText", "bulletLink", "richText", "multiConversations", "conversation", "fileUpload",
]);

export function validatePayload(
  def: WorkflowDefinition,
  payload: Record<string, unknown>,
  fileExists: (p: string) => boolean = existsSync,
): void {
  for (let p = 0; p < def.pages.length; p++) {
    for (const field of def.pages[p]!.fields) {
      if (!VALID_FORMATS.has(field.format)) {
        throw new PayloadValidationError(`unknown format "${field.format}" for field "${field.key}" (page ${p})`);
      }
      const raw = payload[field.key];
      if (raw === undefined) {
        if (field.optional) continue;
        throw new PayloadValidationError(`missing required payload key "${field.key}" (page ${p})`);
      }
      if (field.format === "fileUpload") {
        if (typeof raw !== "string") {
          throw new PayloadValidationError(`fileUpload field "${field.key}" must be a local file path string`);
        }
        if (!fileExists(raw)) {
          throw new PayloadValidationError(`file not found for field "${field.key}": ${raw}`);
        }
      }
    }
  }
}
