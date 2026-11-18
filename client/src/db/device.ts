const KEY = "talaan.deviceId";

/** A random id for this browser profile, stable across users and sessions. The server only uses it
 *  to show which device last synced (protocol section 3); it grants nothing. */
export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(KEY, created);
    return created;
  } catch {
    return (memory ??= crypto.randomUUID());
  }
}
let memory: string | undefined;
