import { toProblem } from "../lib/problem";

/** How the engine reacts to a failed request (docs/protocol.md sections 4, 8, 9). */
export type Failure =
  /** Network error, timeout, 5xx, 429: retry the same batch later. */
  | { kind: "transient"; reason: string; retryAfterMs: number }
  /** 401: stop the cycle, leave the outbox alone, refresh the token or log in again. */
  | { kind: "auth"; reason: string }
  /** 426: this app is too old; keep local data and ask for an update. */
  | { kind: "upgrade"; reason: string }
  /** Anything else (400, 403, ...): a bug or a role problem; retrying will not help. */
  | { kind: "fatal"; reason: string };

export class SyncFailure extends Error {
  readonly failure: Failure;
  constructor(failure: Failure) {
    super(failure.reason);
    this.failure = failure;
  }
}

export function classifyResponse(response: Response, body: unknown): Failure {
  const problem = toProblem(body, response.status);
  const reason = problem.code;
  if (response.status === 401) return { kind: "auth", reason };
  if (response.status === 426) return { kind: "upgrade", reason };
  if (response.status === 429) {
    const header = Number(response.headers.get("Retry-After"));
    const seconds = problem.retry_after ?? (Number.isFinite(header) ? header : 0);
    return { kind: "transient", reason, retryAfterMs: Math.max(0, seconds) * 1000 };
  }
  if (response.status >= 500 || response.status === 408) {
    return { kind: "transient", reason, retryAfterMs: 0 };
  }
  return { kind: "fatal", reason };
}

/** A thrown fetch error (offline, DNS, refused, aborted by timeout) is always transient. */
export function classifyThrown(error: unknown): Failure {
  const name = error instanceof Error ? error.name : "error";
  return {
    kind: "transient",
    reason: name === "TimeoutError" ? "timeout" : "network",
    retryAfterMs: 0,
  };
}
