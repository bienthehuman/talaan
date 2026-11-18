import { api } from "../lib/api";
import { getSession, saveSession } from "./session";

/** - `refreshed`: a new access token is saved; try again.
 *  - `login-required`: the refresh token is missing, expired or revoked; the person must sign in.
 *  - `unreachable`: the server could not be reached or had a problem; the session may still be fine. */
export type RefreshOutcome = "refreshed" | "login-required" | "unreachable";

let inFlight: Promise<RefreshOutcome> | null = null;

/** Trade the refresh token for a new access token. One request at a time: callers that ask while
 *  one is running share its answer. Local data is never touched. */
export function refreshSession(): Promise<RefreshOutcome> {
  inFlight ??= run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(): Promise<RefreshOutcome> {
  const session = getSession();
  if (!session?.refresh) return "login-required";
  try {
    const { data, response } = await api.POST("/api/auth/token/refresh/", {
      body: { refresh: session.refresh } as never,
    });
    if (response.status === 401 || response.status === 400) return "login-required";
    const access = (data as { access?: string } | undefined)?.access;
    if (!response.ok || !access) return "unreachable";
    saveSession({ ...session, access });
    return "refreshed";
  } catch {
    return "unreachable";
  }
}
