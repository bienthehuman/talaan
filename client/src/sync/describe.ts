import type { EngineState } from "./engine";

/** Plain-words versions of the engine's problem codes. */
export function describeProblem(code: string | null): string {
  switch (code) {
    case null:
    case "":
      return "None";
    case "network":
      return "The server could not be reached.";
    case "timeout":
      return "The server took too long to answer.";
    case "server_error":
    case "database_unavailable":
    case "fault_injected":
      return "The server had a problem.";
    case "rate_limited":
      return "The server asked the app to slow down.";
    case "unauthenticated":
    case "session_expired":
      return "Your session expired. Sign in again.";
    case "client_too_old":
      return "This version of the app is too old to sync.";
    case "local_error":
      return "This device could not save data.";
    case "forbidden":
      return "Your account is not allowed to sync.";
    case "empty_results":
      return "The server's answer was incomplete.";
    default:
      return `Problem: ${code}`;
  }
}

export function describeState(state: EngineState, pending: number, retryAt: number | null): string {
  switch (state) {
    case "syncing":
      return "Syncing now.";
    case "retrying":
      return retryAt
        ? `The last attempt failed. Trying again at ${new Date(retryAt).toLocaleTimeString()}.`
        : "The last attempt failed. Trying again soon.";
    case "paused-auth":
      return "Paused. Sign in again to continue.";
    case "upgrade-required":
      return "Stopped. This version of the app is too old to sync; reload to update.";
    case "error":
      return "Stopped by an error. Press Retry now to try again.";
    default:
      return pending > 0
        ? "Waiting for the next sync."
        : "Everything that can be sent has been sent.";
  }
}
