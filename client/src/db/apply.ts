import type { TalaanDb } from "./db";
import type {
  ConflictInfo,
  LocalSubmission,
  OutboxEntry,
  RecordData,
  Shadow,
  SubmissionStatus,
} from "./types";

/** Writes made by the sync engine: what the server said, applied to the local copy. Like
 *  `submissions.ts`, every function is one transaction. Unsent local edits are never lost here:
 *  the visible `data` is always the server's copy with the still-queued entries laid on top. */

/** A record as the server returns it (push results and pull). */
export interface ServerRecord {
  id: string;
  assignment_id: number;
  form_version_id: number;
  version: number;
  field_versions: Record<string, number>;
  data: RecordData;
  status: SubmissionStatus;
  deleted: boolean;
  server_seq: number;
}

export type PushResult =
  | { mutation_id: string; status: "applied"; record: ServerRecord }
  | {
      mutation_id: string;
      status: "conflict";
      conflict: ConflictInfo;
      record: ServerRecord;
    }
  | {
      mutation_id: string;
      status: "rejected";
      code: string;
      detail: string;
      record?: ServerRecord;
    };

const MAX_BATCH = 50;

function toShadow(record: ServerRecord): Shadow {
  return {
    data: { ...record.data },
    status: record.status,
    version: record.version,
    fieldVersions: { ...record.field_versions },
    deleted: record.deleted,
  };
}

/** The server's copy with the queued entries applied on top: what the user should see. */
export function overlay(shadow: Shadow, queued: OutboxEntry[]) {
  const data: RecordData = { ...shadow.data };
  let status = shadow.status;
  let deleted = shadow.deleted;
  for (const entry of queued) {
    for (const [name, value] of Object.entries(entry.fields)) {
      if (value === null) delete data[name];
      else data[name] = value;
    }
    if (entry.op === "submit") status = "submitted";
    if (entry.op === "delete") deleted = true;
  }
  return { data, status, deleted };
}

export async function queuedFor(db: TalaanDb, recordId: string): Promise<OutboxEntry[]> {
  return db.outbox.where("recordId").equals(recordId).sortBy("seq");
}

/** The next batch to send: the oldest queued entry of each record (at most one per record, so a
 *  record's changes go in order), skipping records that need a decision. Entries are stamped
 *  `sentAt` the first time they are chosen and are not changed after that, so a retry resends the
 *  same mutation ids. */
export function takeBatch(db: TalaanDb, now: number = Date.now()): Promise<OutboxEntry[]> {
  return db.transaction("rw", db.outbox, db.submissions, async () => {
    const blocked = new Set(
      (await db.submissions.where("syncState").anyOf("conflict", "rejected").toArray()).map(
        (s) => s.id,
      ),
    );
    const seen = new Set<string>();
    const batch: OutboxEntry[] = [];
    for (const entry of await db.outbox.orderBy("seq").toArray()) {
      if (seen.has(entry.recordId)) continue;
      seen.add(entry.recordId);
      if (blocked.has(entry.recordId)) continue;
      batch.push(entry);
      if (batch.length === MAX_BATCH) break;
    }
    for (const entry of batch) {
      if (entry.sentAt === null) {
        entry.sentAt = now;
        await db.outbox.update(entry.seq!, { sentAt: now });
      }
    }
    return batch;
  });
}

/** The same change as a brand new mutation: new id, not sent yet. It keeps its place in the queue,
 *  so a record's changes still go out in the order they were made. */
export function reissue(db: TalaanDb, entry: OutboxEntry, changes: Partial<OutboxEntry> = {}) {
  return db.outbox.update(entry.seq!, {
    mutationId: crypto.randomUUID(),
    sentAt: null,
    attempts: 0,
    lastError: null,
    ...changes,
  });
}

/** Note a failed attempt on entries that stay queued. */
export function noteFailure(db: TalaanDb, entries: OutboxEntry[], error: string): Promise<void> {
  return db.transaction("rw", db.outbox, async () => {
    for (const entry of entries) {
      const current = await db.outbox.get(entry.seq!);
      if (current)
        await db.outbox.update(entry.seq!, { attempts: current.attempts + 1, lastError: error });
    }
  });
}

/** Apply the server's verdict on one sent entry. */
export function applyResult(db: TalaanDb, entry: OutboxEntry, result: PushResult): Promise<void> {
  return db.transaction("rw", db.submissions, db.outbox, async () => {
    const row = await db.submissions.get(entry.recordId);
    if (result.status === "applied") {
      await db.outbox.delete(entry.seq!);
      if (!row) return;
      const shadow = toShadow(result.record);
      // Entries queued behind this one were written on top of it. If nobody else wrote in between
      // (the new version is exactly their base + 1) they now start from the new version; otherwise
      // they keep their base so the server still sees the other writer.
      const queued = await queuedFor(db, entry.recordId);
      for (const next of queued) {
        if (next.baseVersion + 1 === result.record.version) {
          await db.outbox.update(next.seq!, { baseVersion: result.record.version });
        }
      }
      const view = overlay(shadow, queued);
      await db.submissions.put({
        ...row,
        ...view,
        shadow,
        serverVersion: result.record.version,
        fieldVersions: shadow.fieldVersions,
        syncState: queued.length > 0 ? "pending" : "synced",
        syncDetail: undefined,
        conflict: undefined,
      });
      return;
    }

    if (!row) return;
    // Conflict or rejection: nothing was applied. Keep the user's data and entries, remember what
    // the server holds, and stop sending this record until the user decides.
    const shadow =
      result.status === "rejected" && !result.record ? row.shadow : toShadow(result.record!);
    await db.outbox.update(entry.seq!, {
      lastError: result.status === "conflict" ? `conflict:${result.conflict.kind}` : result.code,
    });
    await db.submissions.put({
      ...row,
      shadow,
      serverVersion: shadow ? shadow.version : row.serverVersion,
      fieldVersions: shadow ? shadow.fieldVersions : row.fieldVersions,
      syncState: result.status === "conflict" ? "conflict" : "rejected",
      syncDetail: result.status === "conflict" ? result.conflict.kind : result.detail,
      conflict: result.status === "conflict" ? result.conflict : undefined,
    });
  });
}

/** Store a pulled page and its cursor together. A record at or below the version already held is
 *  ignored (pull is at-least-once). Unsent edits stay visible on top of the new server copy. */
export function applyPull(
  db: TalaanDb,
  records: ServerRecord[],
  nextCursor: number,
): Promise<void> {
  return db.transaction("rw", db.submissions, db.outbox, db.meta, async () => {
    for (const record of records) {
      const row = await db.submissions.get(record.id);
      const shadow = toShadow(record);
      if (!row) {
        if (record.deleted) continue; // nothing here, and nothing to show
        const local: LocalSubmission = {
          id: record.id,
          assignmentId: record.assignment_id,
          formVersionId: record.form_version_id,
          data: { ...shadow.data },
          status: shadow.status,
          deleted: false,
          serverVersion: record.version,
          fieldVersions: shadow.fieldVersions,
          shadow,
          syncState: "synced",
          updatedAt: Date.now(),
        };
        await db.submissions.add(local);
        continue;
      }
      if (record.version <= row.serverVersion) continue;
      const queued = await queuedFor(db, record.id);

      // The admin restored a record this person was waiting on (`deleted_remotely`): their edits go
      // out again. The old mutation id's stored answer is the conflict, so the entry gets a new id.
      // It keeps its base version, so edits others made before the delete still conflict.
      const restored =
        row.syncState === "conflict" &&
        row.conflict?.kind === "deleted_remotely" &&
        !record.deleted &&
        queued.length > 0;
      if (restored) {
        await reissue(db, queued[0]!);
      }

      const view = overlay(shadow, queued);
      await db.submissions.put({
        ...row,
        ...view,
        ...(restored
          ? { syncState: "pending" as const, syncDetail: undefined, conflict: undefined }
          : {}),
        // Deleted remotely while edits are queued: keep showing the record; the next push reports
        // `deleted_remotely` and the user decides (phase 3).
        deleted: restored ? false : queued.length > 0 ? row.deleted : view.deleted,
        shadow,
        serverVersion: record.version,
        fieldVersions: shadow.fieldVersions,
        updatedAt: Date.now(),
      });
    }
    await db.meta.put({ key: "syncCursor", value: nextCursor });
  });
}

/** Replace the downloaded reference data. */
export function saveReferenceData(
  db: TalaanDb,
  assignments: { id: number }[],
  formVersions: { id: number }[],
): Promise<void> {
  return db.transaction("rw", db.assignments, db.formVersions, async () => {
    await db.assignments.clear();
    await db.assignments.bulkPut(assignments);
    await db.formVersions.clear();
    await db.formVersions.bulkPut(formVersions);
  });
}

export async function getMeta<T extends string | number>(
  db: TalaanDb,
  key: string,
): Promise<T | null> {
  return ((await db.meta.get(key))?.value as T | undefined) ?? null;
}

export function setMeta(db: TalaanDb, key: string, value: string | number): Promise<unknown> {
  return db.meta.put({ key, value });
}
