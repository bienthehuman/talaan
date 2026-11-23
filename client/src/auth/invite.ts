import { api, unwrap } from "../lib/api";
import type { components } from "../lib/api-types";
import { ApiError, NetworkError } from "../lib/problem";

export type InviteInfo = components["schemas"]["InviteInfo"];

/** The invite token from a link like `/invite#<token>`. It is in the fragment so that browsers
 *  never send it, and it reaches the server only in a POST body (ADR 0014). */
export function tokenFromHash(hash: string): string {
  return hash.replace(/^#/, "").trim();
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new NetworkError();
  }
}

export function checkInvite(token: string): Promise<InviteInfo> {
  return call(async () => unwrap(await api.POST("/api/invites/check/", { body: { token } })));
}

export function acceptInvite(token: string, password: string): Promise<{ username: string }> {
  return call(async () =>
    unwrap(await api.POST("/api/invites/accept/", { body: { token, password } })),
  );
}

/** What to tell someone whose link cannot be used, by the server's problem code. */
export const LINK_PROBLEMS: Record<string, string> = {
  invite_expired: "This invite link has expired. Ask your admin to send you a new one.",
  invite_used: "This invite link has already been used. If you set your password, sign in.",
  invite_revoked: "This invite link was withdrawn. Ask your admin to send you a new one.",
  invite_not_found:
    "This invite link isn't valid. Check that you opened the whole link, or ask your admin for a new one.",
};
