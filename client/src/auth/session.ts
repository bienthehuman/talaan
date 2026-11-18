/** Persisted session so the app opens offline after the first login.
 *
 *  Tokens live in localStorage; the trade-off and the alternatives are in ADR 0010. Local data is
 *  kept in one IndexedDB database per user (src/db). */

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
