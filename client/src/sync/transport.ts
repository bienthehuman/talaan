import { api } from "../lib/api";
import type { PushResult, ServerRecord } from "../db";
import type { OutboxEntry } from "../db/types";
import { classifyResponse, classifyThrown, SyncFailure } from "./classify";

/** The protocol version this app speaks (docs/protocol.md section 2). */
export const CLIENT_SCHEMA = 1;
export const REQUEST_TIMEOUT_MS = 30_000;

export interface PullPage {
  records: ServerRecord[];
  next_cursor: number;
  has_more: boolean;
}

interface Result<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

async function settle<T>(call: () => Promise<Result<T>>): Promise<T> {
  let result: Result<T>;
  try {
    result = await call();
  } catch (error) {
    throw new SyncFailure(classifyThrown(error));
  }
  if (!result.response.ok || result.data === undefined) {
    throw new SyncFailure(classifyResponse(result.response, result.error));
  }
  return result.data;
}

const signal = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);
const header = { "X-Client-Schema": CLIENT_SCHEMA };

export function pushBatch(deviceId: string, entries: OutboxEntry[]): Promise<PushResult[]> {
  return settle(() =>
    api.POST("/api/sync/push/", {
      signal: signal(),
      body: {
        device_id: deviceId,
        client_schema: CLIENT_SCHEMA,
        app_version: import.meta.env.VITE_APP_VERSION ?? "dev",
        mutations: entries.map((e) => ({
          mutation_id: e.mutationId,
          record_id: e.recordId,
          op: e.op,
          base_version: e.baseVersion,
          fields: e.fields,
          ...(e.op === "create" ? { assignment_id: e.assignmentId } : {}),
        })),
      },
    }),
  ).then((body) => (body as unknown as { results: PushResult[] }).results);
}

export function pullPage(cursor: number): Promise<PullPage> {
  return settle(() =>
    api.GET("/api/sync/pull/", {
      signal: signal(),
      params: { query: { cursor }, header },
    }),
  ).then((body) => body as unknown as PullPage);
}

export function fetchAssignments() {
  return settle(() => api.GET("/api/assignments/", { signal: signal(), params: { header } })).then(
    (body) => body.results,
  );
}

export function fetchFormVersions() {
  return settle(() =>
    api.GET("/api/form-versions/", { signal: signal(), params: { header } }),
  ).then((body) => body.results);
}
