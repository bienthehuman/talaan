const BASE_MS = 1_000;
const CAP_MS = 60_000;

/** Wait before retry number `attempt` (1 = first retry): exponential with full jitter, never less
 *  than the server's `Retry-After`. `random` is injectable so tests are exact. */
export function backoffMs(
  attempt: number,
  retryAfterMs = 0,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(CAP_MS, BASE_MS * 2 ** Math.max(0, attempt - 1));
  return Math.max(retryAfterMs, Math.round(random() * ceiling));
}
