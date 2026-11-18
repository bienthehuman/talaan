import { useEffect, useState } from "react";

export type StorageState = "unknown" | "protected" | "not-protected" | "unsupported";

/** Whether the browser has promised not to clear this site's data when space runs low. */
export async function readStorageState(): Promise<StorageState> {
  if (!navigator.storage?.persisted) return "unsupported";
  try {
    return (await navigator.storage.persisted()) ? "protected" : "not-protected";
  } catch {
    return "unknown";
  }
}

/** Ask the browser to protect local data, once the device has completed a sync (so there is something
 *  worth protecting, and the person has used the app). The browser decides; the answer is returned. */
export function useStoragePersistence(ready: boolean): StorageState {
  const [state, setState] = useState<StorageState>("unknown");
  useEffect(() => {
    if (!ready) return;
    let current = true;
    (async () => {
      let result = await readStorageState();
      if (result === "not-protected" && navigator.storage.persist) {
        try {
          result = (await navigator.storage.persist()) ? "protected" : "not-protected";
        } catch {
          result = "unknown";
        }
      }
      if (current) setState(result);
    })();
    return () => {
      current = false;
    };
  }, [ready]);
  return state;
}
