import type { EngineState } from "./engine";

/** Plain-words versions of the engine's problem codes. */
export function describeProblem(code: string | null): string {
  switch (code) {
    case null:
    case "":
      return "None";
    case "network":
      return "Couldn't reach the office. Check your signal.";
    case "timeout":
      return "The office took too long to answer.";
    case "server_error":
    case "database_unavailable":
    case "fault_injected":
      return "The office system had a problem.";
    case "rate_limited":
      return "The office system is busy.";
    case "unauthenticated":
    case "session_expired":
      return "You need to enter your password again.";
    case "client_too_old":
      return "This version of the app is out of date.";
    case "local_error":
      return "This device couldn't save your work.";
    case "forbidden":
      return "Your account isn't allowed to send inspections.";
    case "empty_results":
      return "The office's answer was incomplete.";
    default:
      return "Something went wrong while sending.";
  }
}

export function describeState(state: EngineState, pending: number, retryAt: number | null): string {
  switch (state) {
    case "syncing":
      return "Sending now.";
    case "retrying":
      return retryAt
        ? `Couldn't send. Trying again at ${new Date(retryAt).toLocaleTimeString()}.`
        : "Couldn't send. Trying again soon.";
    case "paused-auth":
      return "Paused. Enter your password to continue.";
    case "upgrade-required":
      return "Stopped. This version of the app is out of date. Reload the page to update.";
    case "error":
      return "Stopped by a problem. Press Try again now.";
    default:
      return pending > 0 ? "Waiting to send." : "All your work has been sent.";
  }
}
