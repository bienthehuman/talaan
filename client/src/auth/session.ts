/** Persisted session so the app opens offline after the first login.
 *
 *  Tokens live in localStorage for the skeleton. This is a known trade-off (readable by any script
 *  on the origin, which CSP limits to our own); phase 2 revisits it together with token refresh and
 *  keys all local data by userId. */

export interface SessionUser {
  id: number;
  username: string;
  role: string | null;
  permissions: string[];
}

export interface Session {
  access: string;
  refresh: string;
  user: SessionUser;
}

const KEY = "talaan.session";
let memory: Session | null = null;

export function getSession(): Session | null {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) memory = JSON.parse(raw) as Session;
  } catch {
    memory = null;
  }
  return memory;
}

export function saveSession(session: Session): void {
  memory = session;
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // keep in memory only
  }
}

export function clearSession(): void {
  memory = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
