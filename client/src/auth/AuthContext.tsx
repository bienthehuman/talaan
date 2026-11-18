import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { deleteDbFor } from "../db";
import { api, unwrap } from "../lib/api";
import { ApiError, NetworkError } from "../lib/problem";
import { stopEngineFor } from "../sync/engine";
import { clearSession, getSession, saveSession, type SessionUser } from "./session";

interface AuthValue {
  user: SessionUser | null;
  /** Throws ApiError or NetworkError; callers turn those into messages with messageFor(). */
  login: (username: string, password: string) => Promise<void>;
  /** Sign in again as the same person after the session expired. Local data is kept. Throws
   *  ApiError or NetworkError, or WrongUserError if the credentials belong to someone else. */
  reauthenticate: (password: string) => Promise<void>;
  /** Sign out and remove this person's data from the device. */
  logout: () => void;
}

export class WrongUserError extends Error {}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(() => getSession()?.user ?? null);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const tokens = unwrap(await api.POST("/api/auth/token/", { body: { username, password } }));

      // Store the token first so the /me request carries it.
      saveSession({ ...tokens, user: { id: 0, username, role: null, permissions: [] } });
      let me;
      try {
        me = unwrap(await api.GET("/api/me/"));
      } catch (err) {
        clearSession();
        throw err;
      }
      saveSession({ ...tokens, user: me });
      setUser(me);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new NetworkError();
    }
  }, []);

  const reauthenticate = useCallback(async (password: string) => {
    const current = getSession()?.user;
    if (!current) throw new WrongUserError();
    try {
      const tokens = unwrap(
        await api.POST("/api/auth/token/", { body: { username: current.username, password } }),
      );
      // Check who this is before keeping the tokens: never swap in someone else's session.
      const me = unwrap(
        await api.GET("/api/me/", { headers: { Authorization: `Bearer ${tokens.access}` } }),
      );
      if (me.id !== current.id) throw new WrongUserError();
      saveSession({ ...tokens, user: me });
      setUser(me);
    } catch (err) {
      if (err instanceof ApiError || err instanceof WrongUserError) throw err;
      throw new NetworkError();
    }
  }, []);

  const logout = useCallback(() => {
    const leaving = getSession()?.user.id ?? user?.id;
    clearSession();
    setUser(null);
    if (leaving !== undefined) {
      // A shared device must not keep the last person's records. Stop their sync, then delete.
      void stopEngineFor(leaving).then(() => deleteDbFor(leaving));
    }
  }, [user]);

  const value = useMemo(
    () => ({ user, login, reauthenticate, logout }),
    [user, login, reauthenticate, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
