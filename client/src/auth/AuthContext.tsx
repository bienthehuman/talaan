import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { api, unwrap } from "../lib/api";
import { ApiError, NetworkError } from "../lib/problem";
import { clearSession, getSession, saveSession, type SessionUser } from "./session";

interface AuthValue {
  user: SessionUser | null;
  /** Throws ApiError or NetworkError; callers turn those into messages with messageFor(). */
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

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

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, login, logout }), [user, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
