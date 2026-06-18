import { z } from "zod";
import type { Session } from "../cdp/types.ts";
import { apiCall } from "./client.ts";

const GetUploadUrl = z.object({
  ok: z.literal(true),
  file: z.string(),
  upload_url: z.string().url(),
});

const CompleteUpload = z.object({
  ok: z.literal(true),
  files: z.array(z.object({ id: z.string(), title: z.string() })).min(1),
});

export interface UploadFileInput {
  bytes: Uint8Array;
  filename: string;
  title?: string;
}

export interface UploadedFile {
  id: string;
  title: string;
}

export async function uploadFile(session: Session, input: UploadFileInput): Promise<UploadedFile> {
  // 1) Reserve upload slot
  const reserveRaw = await apiCall<unknown>(session, "files.getUploadURL", {
    filename: input.filename,
    length: input.bytes.byteLength,
  });
  const reserved = GetUploadUrl.parse(reserveRaw);

  // 2) Upload — done inside the renderer so the request goes out from Slack's origin.
  //    The upload endpoint expects a raw binary body (NOT multipart/form-data) and
  //    rejects requests that trigger a CORS preflight, so we omit `credentials`.
  //    Base64 keeps the embedded payload ~33% larger than binary instead of ~4x with
  //    a `[1,2,3,...]` array literal.
  const b64 = Buffer.from(input.bytes).toString("base64");
  const expr = `(async () => {
    const bin = atob(${JSON.stringify(b64)});
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const r = await fetch(${JSON.stringify(reserved.upload_url)}, {
      method: 'POST',
      body: bytes,
    });
    return { ok: r.ok, status: r.status };
  })()`;
  // Marker so the test can identify this evaluation
  const wrapped = `(/* __sa_upload(${reserved.file}) */ ${expr})`;
  const uploadResult = await session.evaluate<{ ok: boolean; status: number }>(wrapped);
  if (!uploadResult.ok) {
    throw new Error(`file upload failed with status ${uploadResult.status}`);
  }

  // 3) Confirm
  const completeRaw = await apiCall<unknown>(session, "files.completeUpload", {
    files: JSON.stringify([{ id: reserved.file, title: input.title ?? input.filename }]),
  });
  const completed = CompleteUpload.parse(completeRaw);
  return completed.files[0]!;
}
