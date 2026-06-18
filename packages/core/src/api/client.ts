import type { Session } from "../cdp/types.ts";

export type ApiPermission = "r" | "rw";

/**
 * Harvest the xoxc token from the renderer.
 *
 * Slack's web API requires the user's `xoxc-...` token in the request body
 * IN ADDITION to the session cookie ("d"). `credentials: 'include'` alone
 * returns `{"ok":false,"error":"not_authed"}`. We probe several known
 * locations inside the renderer (Slack changes the storage spot between
 * client versions). Returns the token or null.
 */
export const HARVEST_TOKEN_JS = `(() => {
  try { if (window.TS && window.TS.boot_data && window.TS.boot_data.api_token) return window.TS.boot_data.api_token; } catch (e) {}
  try {
    const raw = window.localStorage.getItem('localConfig_v2');
    if (raw) {
      const parsed = JSON.parse(raw);
      const teams = (parsed && parsed.teams) || {};
      for (const k of Object.keys(teams)) {
        const t = teams[k];
        if (t && typeof t.token === 'string' && t.token.indexOf('xoxc-') === 0) return t.token;
      }
    }
  } catch (e) {}
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      const v = window.localStorage.getItem(k);
      if (!v) continue;
      const m = v.match(/xoxc-[A-Za-z0-9-]{40,}/);
      if (m) return m[0];
    }
  } catch (e) {}
  return null;
})()`;

/**
 * Harvest the current user's Slack ID (e.g. "U05K32AMXXX") from the renderer.
 * Used by patterns with `exclude_users: ["self"]` to skip the operator's own messages.
 */
export async function harvestSelfUserId(session: Session): Promise<string | null> {
  return session.evaluate<string | null>(`(() => {
    try { if (window.TS && window.TS.boot_data && window.TS.boot_data.user_id) return window.TS.boot_data.user_id; } catch (e) {}
    try {
      const raw = window.localStorage.getItem('localConfig_v2');
      if (raw) {
        const parsed = JSON.parse(raw);
        const teams = (parsed && parsed.teams) || {};
        for (const k of Object.keys(teams)) {
          const t = teams[k];
          if (t && typeof t.user_id === 'string' && t.user_id.indexOf('U') === 0) return t.user_id;
        }
      }
    } catch (e) {}
    return null;
  })()`);
}

export async function apiCall<T>(
  session: Session,
  path: string,
  params: Record<string, string | number | boolean>,
): Promise<T> {
  const body = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");

  const expr = `(async () => {
    const tok = ${HARVEST_TOKEN_JS};
    if (!tok) throw new Error("apiCall: could not locate xoxc token in renderer (tried TS.boot_data, localConfig_v2, full localStorage scan)");
    const baseBody = ${JSON.stringify(body)};
    const fullBody = 'token=' + encodeURIComponent(tok) + (baseBody ? '&' + baseBody : '');
    const r = await fetch('/api/${path}', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: fullBody,
      credentials: 'include',
    });
    return r.json();
  })()`;

  return session.evaluate<T>(expr);
}

/**
 * ApiClient<P> exposes a method surface gated by permission. Read-only methods
 * are available with both 'r' and 'rw'; write methods only with 'rw'.
 *
 * The actual method bindings live in api/workflows.ts, api/views.ts, etc.,
 * and are wired together in api/index.ts (Task 13b).
 */
export interface ApiClient<P extends ApiPermission = "rw"> {
  readonly session: Session;
  readonly permission: P;
}
