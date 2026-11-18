import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { dbFor, type TalaanDb } from ".";

/** The signed-in person's local database, or null when signed out. */
export function useLocalDb(): TalaanDb | null {
  const { user } = useAuth();
  return user ? dbFor(user.id) : null;
}

/** Re-runs a local query whenever the data it reads changes (including changes made by the sync
 *  engine or another tab). `ready` is false until the first answer arrives. */
export function useLive<T>(
  query: () => Promise<T>,
  deps: unknown[],
): { value: T | undefined; ready: boolean } {
  const [state, setState] = useState<{ value: T | undefined; ready: boolean }>({
    value: undefined,
    ready: false,
  });
  useEffect(() => {
    const subscription = liveQuery(query).subscribe({
      next: (value) => setState({ value, ready: true }),
      error: () => setState({ value: undefined, ready: true }),
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
