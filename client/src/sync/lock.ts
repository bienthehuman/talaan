/** One sync at a time per user, across tabs (ADR 0009). Uses Web Locks where available; otherwise
 *  an in-page set, which still serialises engines inside one tab. */

const held = new Set<string>();

export const BUSY = Symbol("busy");

export async function withSyncLock<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T | typeof BUSY> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(name, { ifAvailable: true }, async (lock) =>
      lock ? fn() : BUSY,
    ) as Promise<T | typeof BUSY>;
  }
  if (held.has(name)) return BUSY;
  held.add(name);
  try {
    return await fn();
  } finally {
    held.delete(name);
  }
}
