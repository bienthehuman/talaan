import { liveQuery } from "dexie";
import { useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { SyncContext } from "./context";
import type { EngineState } from "./engine";

/** What the header shows. Without an engine (signed out, or a test with no provider) nothing is
 *  pending and nothing has synced. */
export interface SyncStatus {
  pending: number;
  /** Inspections waiting for the person to decide a conflict. */
  conflicts: number;
  lastSyncAt: Date | null;
  state: EngineState;
  syncNow: () => void;
  /** Why the last cycle failed (a problem code), for the banner. */
  lastError: string | null;
  /** Carry on after the person has signed in again. */
  resume: () => void;
}

const NONE = { subscribe: () => () => {}, getStatus: () => IDLE };
const IDLE = { state: "idle", lastSyncAt: null, retryAt: null, lastError: null } as const;

export function useSyncStatus(): SyncStatus {
  const sync = useContext(SyncContext);
  const source = sync ?? NONE;
  const engineStatus = useSyncExternalStore(source.subscribe, source.getStatus);

  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  useEffect(() => {
    if (!sync) return;
    const subscription = liveQuery(() => sync.db.outbox.count()).subscribe({
      next: setPending,
      error: () => setPending(0),
    });
    const waiting = liveQuery(() =>
      sync.db.submissions.where("syncState").equals("conflict").count(),
    ).subscribe({ next: setConflicts, error: () => setConflicts(0) });
    return () => {
      subscription.unsubscribe();
      waiting.unsubscribe();
    };
  }, [sync]);

  const syncNow = useCallback(() => void sync?.syncNow(), [sync]);
  const resume = useCallback(() => void sync?.resume(), [sync]);
  return {
    pending: sync ? pending : 0,
    conflicts: sync ? conflicts : 0,
    lastSyncAt: engineStatus.lastSyncAt === null ? null : new Date(engineStatus.lastSyncAt),
    state: engineStatus.state,
    syncNow,
    resume,
    lastError: engineStatus.lastError,
  };
}
