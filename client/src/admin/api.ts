import { api, unwrap } from "../lib/api";
import { ApiError, NetworkError } from "../lib/problem";
import type { components } from "../lib/api-types";

export type SubmissionRow = components["schemas"]["SubmissionRow"];
export type SubmissionDetail = components["schemas"]["SubmissionDetail"];
export type AdminEvent = components["schemas"]["Event"];
export type UserRef = components["schemas"]["UserRef"];
export type ActionResult = components["schemas"]["MutationResult"];
export type SubmissionStatus = components["schemas"]["SubmissionStatusEnum"];
export type AdminAction = "approve" | "return" | "restore" | "delete" | "edit";

export interface QueueQuery {
  status?: SubmissionStatus;
  worker?: number;
  deleted: "true" | "false" | "any";
  limit: number;
  offset: number;
}

/** A request that never reached the server is a NetworkError, so pages can say so plainly. */
async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new NetworkError();
  }
}

export async function listSubmissions(query: QueueQuery) {
  return call(async () => unwrap(await api.GET("/api/admin/submissions/", { params: { query } })));
}

export async function getSubmission(id: string): Promise<SubmissionDetail> {
  return call(async () =>
    unwrap(
      await api.GET("/api/admin/submissions/{record_id}/", {
        params: { path: { record_id: id } },
      }),
    ),
  );
}

export async function listWorkers(): Promise<UserRef[]> {
  return call(async () => unwrap(await api.GET("/api/admin/workers/")) as unknown as UserRef[]);
}

/** One admin action. The answer is the service's result: `applied`, `rejected` or `conflict`. */
export async function act(
  id: string,
  action: AdminAction,
  extra: { reason?: string; fields?: Record<string, unknown> } = {},
): Promise<ActionResult> {
  return call(async () =>
    unwrap(
      await api.POST("/api/admin/submissions/{record_id}/actions/", {
        params: { path: { record_id: id } },
        body: { action, reason: extra.reason ?? "", fields: extra.fields },
      }),
    ),
  );
}
