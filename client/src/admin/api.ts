import { refreshSession } from "../auth/refresh";
import { api, unwrap } from "../lib/api";
import { ApiError, NetworkError } from "../lib/problem";
import type { components } from "../lib/api-types";

export type SubmissionRow = components["schemas"]["SubmissionRow"];
export type SubmissionDetail = components["schemas"]["SubmissionDetail"];
export type AdminEvent = components["schemas"]["Event"];
export type UserRef = components["schemas"]["UserRef"];
export type Worker = components["schemas"]["AdminWorker"];
export type Invite = components["schemas"]["AdminInvite"];
export type InviteWithToken = components["schemas"]["AdminInviteWithToken"];
export type InviteStatus = components["schemas"]["InviteStatusEnum"];
export type ActionResult = components["schemas"]["MutationResult"];
export type SubmissionStatus = components["schemas"]["SubmissionStatusEnum"];
export type Assignment = components["schemas"]["AdminAssignment"];
export type Form = components["schemas"]["Form"];
export type FormVersionDetail = components["schemas"]["FormVersionDetail"];
export type FormDraft = components["schemas"]["FormDraft"];
export type SchemaChange = components["schemas"]["SchemaChange"];
export type ConflictRow = components["schemas"]["ConflictLogRow"];
export type AdminAction = "approve" | "return" | "restore" | "delete" | "edit";

export interface QueueQuery {
  status?: SubmissionStatus;
  worker?: number;
  deleted: "true" | "false" | "any";
  limit: number;
  offset: number;
}

/** A request that never reached the server is a NetworkError, so pages can say so plainly.
 *
 *  The access token lives 5 minutes and admins have no sync engine to renew it, so a 401 trades the
 *  refresh token for a new access token once and repeats the request. Repeating is safe: the server
 *  checks the token before the view runs, so the first attempt changed nothing. If the refresh token
 *  is refused too, the error becomes `session_expired`. */
async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await attempt(run);
  } catch (error) {
    if (!isUnauthenticated(error)) throw error;
    const outcome = await refreshSession();
    if (outcome === "login-required") throw new ApiError({ status: 401, code: "session_expired" });
    if (outcome === "unreachable") throw new NetworkError();
    return attempt(run);
  }
}

async function attempt<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new NetworkError();
  }
}

function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.problem.status === 401;
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

export async function listWorkers(): Promise<Worker[]> {
  return call(async () => unwrap(await api.GET("/api/admin/workers/")) as unknown as Worker[]);
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

// --- forms ------------------------------------------------------------------------------------

export async function listForms(): Promise<Form[]> {
  const page = await call(async () =>
    unwrap(await api.GET("/api/admin/forms/", { params: { query: { limit: 200 } } })),
  );
  return page.results;
}

export async function createForm(name: string): Promise<Form> {
  return call(async () => unwrap(await api.POST("/api/admin/forms/", { body: { name } })));
}

export async function getFormVersion(id: number): Promise<FormVersionDetail> {
  return call(async () =>
    unwrap(await api.GET("/api/admin/form-versions/{id}/", { params: { path: { id } } })),
  );
}

/** What publishing would report, without publishing. With a form id it also checks the
 *  schema against that form's published versions and lists what changes. */
export async function checkSchema(schema: unknown, formId?: number) {
  return call(async () =>
    unwrap(
      await api.POST("/api/admin/forms/check-schema/", {
        body: formId === undefined ? { schema } : { schema, form_id: formId },
      }),
    ),
  );
}

/** The form's draft (ADR 0013), or null when it has none. */
export async function getDraft(formId: number): Promise<FormDraft | null> {
  try {
    return await call(async () =>
      unwrap(await api.GET("/api/admin/forms/{id}/draft/", { params: { path: { id: formId } } })),
    );
  } catch (error) {
    if (error instanceof ApiError && error.problem.status === 404) return null;
    throw error;
  }
}

/** Save the draft over `revision` (0 starts one). Someone else's save in between is a 409
 *  `stale_draft`; read it with `staleDraft`. */
export async function saveDraft(
  formId: number,
  schema: unknown,
  revision: number,
): Promise<FormDraft> {
  return call(async () =>
    unwrap(
      await api.PUT("/api/admin/forms/{id}/draft/", {
        params: { path: { id: formId } },
        body: { schema, revision },
      }),
    ),
  );
}

export async function publishDraft(formId: number, revision: number): Promise<FormVersionDetail> {
  return call(async () =>
    unwrap(
      await api.POST("/api/admin/forms/{id}/draft/publish/", {
        params: { path: { id: formId } },
        body: { revision },
      }),
    ),
  );
}

/** For a 409 `stale_draft`: the draft as it is now (null once it was published). `undefined` for
 *  any other error. */
export function staleDraft(error: unknown): FormDraft | null | undefined {
  if (!(error instanceof ApiError) || error.problem.code !== "stale_draft") return undefined;
  const draft = (error.problem as { draft?: FormDraft | null }).draft;
  return draft ?? null;
}

// --- assignments ------------------------------------------------------------------------------

export async function listAssignments(query: {
  worker?: number;
  cancelled: "true" | "false" | "any";
  limit: number;
  offset: number;
}) {
  return call(async () => unwrap(await api.GET("/api/admin/assignments/", { params: { query } })));
}

export async function createAssignment(body: {
  form_version_id: number;
  worker_id: number;
  site_name: string;
  due_date?: string | null;
}): Promise<Assignment> {
  return call(async () => unwrap(await api.POST("/api/admin/assignments/", { body })));
}

export async function cancelAssignment(id: number): Promise<Assignment> {
  return call(async () =>
    unwrap(await api.POST("/api/admin/assignments/{id}/cancel/", { params: { path: { id } } })),
  );
}

// --- worker invites (ADR 0014) ---------------------------------------------------------------

export async function listInvites(query: { status?: InviteStatus; limit: number; offset: number }) {
  return call(async () => unwrap(await api.GET("/api/admin/invites/", { params: { query } })));
}

/** The response is the only time the token is sent; the link is `inviteLink(token)`. */
export async function createInvite(body: {
  username: string;
  first_name: string;
  last_name: string;
}): Promise<InviteWithToken> {
  return call(async () => unwrap(await api.POST("/api/admin/invites/", { body })));
}

/** A new token and a new 7 days for an open invite; the old link stops working. */
export async function newInviteLink(id: number): Promise<InviteWithToken> {
  return call(async () =>
    unwrap(await api.POST("/api/admin/invites/{id}/new-link/", { params: { path: { id } } })),
  );
}

export async function revokeInvite(id: number): Promise<Invite> {
  return call(async () =>
    unwrap(await api.POST("/api/admin/invites/{id}/revoke/", { params: { path: { id } } })),
  );
}

/** The token goes in the fragment, which browsers never send, so it stays out of request logs. */
export function inviteLink(token: string, origin = window.location.origin): string {
  return `${origin}/invite#${token}`;
}

// --- conflict log -----------------------------------------------------------------------------

export async function listConflicts(query: {
  kind?: "conflict" | "rejected";
  changed_since?: "true" | "false";
  worker?: number;
  limit: number;
  offset: number;
}) {
  return call(async () => unwrap(await api.GET("/api/admin/conflicts/", { params: { query } })));
}
