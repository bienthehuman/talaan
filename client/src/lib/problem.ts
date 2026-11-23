/** RFC 7807 problem+json from the API (docs/protocol.md section 9) and plain-language messages. */

export interface Problem {
  status: number;
  code: string;
  detail?: string;
  errors?: unknown;
  retry_after?: number;
}

/** Thrown when a request never reached the server (offline, DNS, refused). */
export class NetworkError extends Error {
  constructor() {
    super("network_error");
    this.name = "NetworkError";
  }
}

export class ApiError extends Error {
  readonly problem: Problem;
  constructor(problem: Problem) {
    super(problem.code);
    this.name = "ApiError";
    this.problem = problem;
  }
}

export function toProblem(body: unknown, status: number): Problem {
  if (body && typeof body === "object" && "code" in body && typeof body.code === "string") {
    return { status, ...(body as Omit<Problem, "status">) };
  }
  return { status, code: status >= 500 ? "server_error" : "error" };
}

export type MessageContext = "login" | "general";

/** Sentence-case, what-happened-and-what-to-do messages. */
export function messageFor(error: unknown, context: MessageContext = "general"): string {
  if (error instanceof NetworkError) {
    return "Can't connect. Check your signal or internet connection and try again.";
  }
  if (error instanceof ApiError) {
    const { code, retry_after } = error.problem;
    if (code === "rate_limited") {
      const wait = retry_after ?? 60;
      return `Too many attempts. Try again in ${wait} ${wait === 1 ? "second" : "seconds"}.`;
    }
    if (code === "session_expired") {
      return "Your sign-in has expired. Sign out, then sign in again.";
    }
    if (context === "login") {
      if (code === "unauthenticated") return "Wrong username or password.";
      if (code === "validation_error") return "Enter your username and password.";
    }
    if (code === "server_error" || code === "database_unavailable") {
      return "Something went wrong on our side. Try again in a moment.";
    }
  }
  return "Something went wrong. Try again.";
}

/** Field errors from a 400 `validation_error`: `{field: ["sentence", ...]}`, or null. */
export function fieldErrors(error: unknown): Record<string, string[]> | null {
  if (!(error instanceof ApiError)) return null;
  const errors = error.problem.errors;
  if (!errors || typeof errors !== "object" || Array.isArray(errors)) return null;
  const out: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(errors)) {
    out[name] = Array.isArray(value) ? value.map(String) : [String(value)];
  }
  return out;
}
