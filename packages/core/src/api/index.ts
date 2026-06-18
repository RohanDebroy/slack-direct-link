import type { Session } from "../cdp/types.ts";
import { triggersTrip, type TriggersTripInput, type TriggersTripResponse } from "./workflows.ts";
import { viewsGet, viewsSubmit, type ViewsGetResponse, type ViewsSubmitResponse } from "./views.ts";
import { uploadFile, type UploadFileInput, type UploadedFile } from "./files.ts";
import { conversationsList, conversationsMark, type ChannelMap } from "./conversations.ts";

export type ApiPermission = "r" | "rw";

type WriteOnly<P extends ApiPermission, T> = P extends "rw" ? T : never;

export interface ApiClient<P extends ApiPermission = "rw"> {
  readonly session: Session;
  readonly permission: P;

  // read methods — always available
  conversationsList(): Promise<ChannelMap>;
  viewsGet(viewId: string): Promise<ViewsGetResponse>;

  // write methods — `never` when P is "r", so calls fail to type-check
  triggersTrip:     WriteOnly<P, (input: TriggersTripInput) => Promise<TriggersTripResponse>>;
  viewsSubmit:      WriteOnly<P, (input: { view_id: string; state: { values: Record<string, unknown> } }) => Promise<ViewsSubmitResponse>>;
  uploadFile:       WriteOnly<P, (input: UploadFileInput) => Promise<UploadedFile>>;
  conversationsMark:WriteOnly<P, (input: { channel: string; ts: string }) => Promise<void>>;
}

export function createApiClient<P extends ApiPermission>(session: Session, permission: P): ApiClient<P> {
  // The runtime object always exposes every method; TS hides the write methods
  // from `ApiClient<'r'>` consumers via the `WriteOnly` conditional type.
  const all = {
    session, permission,
    conversationsList: () => conversationsList(session),
    viewsGet:          (id: string) => viewsGet(session, id),
    triggersTrip:      (i: TriggersTripInput) => triggersTrip(session, i),
    viewsSubmit:       (i: { view_id: string; state: { values: Record<string, unknown> } }) => viewsSubmit(session, i),
    uploadFile:        (i: UploadFileInput) => uploadFile(session, i),
    conversationsMark: (i: { channel: string; ts: string }) => conversationsMark(session, i),
  };
  return all as unknown as ApiClient<P>;
}
