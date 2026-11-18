import { useEffect, useMemo, type ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";
import { refreshSession } from "../auth/refresh";
import { dbFor, getDeviceId } from "../db";
import { SyncContext, type EngineHandle } from "./context";
import { SyncEngine } from "./engine";

/** Runs the sync engine for the signed-in user and stops it on sign-out. */
export function SyncProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const engine = useMemo(
    () =>
      userId === null
        ? null
        : new SyncEngine({
            db: dbFor(userId),
            userId,
            deviceId: getDeviceId(),
            refresh: refreshSession,
          }),
    [userId],
  );

  useEffect(() => {
    if (!engine) return;
    engine.start();
    return () => engine.stop();
  }, [engine]);

  const value = useMemo<EngineHandle | null>(
    () =>
      engine && userId !== null
        ? {
            getStatus: engine.getStatus,
            subscribe: engine.subscribe,
            syncNow: () => engine.syncNow(),
            resume: () => engine.resume(),
            db: dbFor(userId),
          }
        : null,
    [engine, userId],
  );
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
