import type { TalaanDb } from "./db";
import type { FieldValue, LocalSubmission, OutboxEntry, RecordData } from "./types";

/** The local write path. Every change to a record and its outbox entry happens in ONE IndexedDB
 *  transaction, so a tab killed mid-write leaves both or neither (scenario 12). Nothing else may
 *  write `submissions` or `outbox`; the sync engine uses the functions in `./apply` (slice 2.2). */

export class NotFoundError extends Error {
  constructor(id: string) {
    super(`No local submission ${id}`);
  }
}
/** The record cannot be edited on this device right now (submitted, approved, or unresolved). */
export class NotEditableError extends Error {}

const EDITABLE_STATUS = new Set(["draft", "returned"]);

function newMutationId(): string {
  return crypto.randomUUID();
}

async function lastEntry(db: TalaanDb, recordId: string): Promise<OutboxEntry | undefined> {
  return db.outbox.where("recordId").equals(recordId).last();
}

async function load(db: TalaanDb, id: string): Promise<LocalSubmission> {
  const row = await db.submissions.get(id);
  if (!row) throw new NotFoundError(id);
  return row;
}

function assertEditable(row: LocalSubmission): void {
  if (row.deleted) throw new NotEditableError("This submission was deleted.");
  if (!EDITABLE_STATUS.has(row.status))
    throw new NotEditableError(`The submission is ${row.status}.`);
  if (row.syncState === "conflict" || row.syncState === "rejected") {
    throw new NotEditableError("Resolve or discard the sync problem first.");
  }
}

function applyPatch(data: RecordData, patch: Record<string, FieldValue>): RecordData {
  const next = { ...data };
  for (const [name, value] of Object.entries(patch)) {
    if (value === null) delete next[name];
    else next[name] = value;
  }
  return next;
}

function changedOnly(data: RecordData, patch: Record<string, FieldValue>) {
  const changed: Record<string, FieldValue> = {};
  for (const [name, value] of Object.entries(patch)) {
    const current = name in data ? data[name] : null;
    if (current !== value) changed[name] = value;
  }
  return changed;
}

export interface NewSubmission {
  assignmentId: number;
  formVersionId: number;
  data?: RecordData;
  /** Client-generated id (ADR 0001). Omit to generate one. */
  id?: string;
}

export function createSubmission(db: TalaanDb, input: NewSubmission): Promise<LocalSubmission> {
  const id = input.id ?? crypto.randomUUID();
  const data = input.data ?? {};
  const row: LocalSubmission = {
    id,
    assignmentId: input.assignmentId,
    formVersionId: input.formVersionId,
    data,
    status: "draft",
    deleted: false,
    serverVersion: 0,
    fieldVersions: {},
    shadow: null,
    syncState: "pending",
    updatedAt: Date.now(),
  };
  return db.transaction("rw", db.submissions, db.outbox, async () => {
    await db.submissions.add(row);
    await db.outbox.add({
      mutationId: newMutationId(),
      recordId: id,
      op: "create",
      fields: { ...data },
      baseVersion: 0,
      assignmentId: input.assignmentId,
      sentAt: null,
      attempts: 0,
      lastError: null,
    });
    return row;
  });
}

/** Set fields (`null` clears one). Edits to a record with an unsent create or update join that
 *  entry; an entry that has been sent is frozen, so a new entry follows it. */
export function editSubmission(
  db: TalaanDb,
  id: string,
  patch: Record<string, FieldValue>,
): Promise<LocalSubmission> {
  return db.transaction("rw", db.submissions, db.outbox, async () => {
    const row = await load(db, id);
    assertEditable(row);
    const changed = changedOnly(row.data, patch);
    if (Object.keys(changed).length === 0) return row;

    const next: LocalSubmission = {
      ...row,
      data: applyPatch(row.data, changed),
      syncState: "pending",
      updatedAt: Date.now(),
    };
    const last = await lastEntry(db, id);
    if (last && last.sentAt === null && (last.op === "create" || last.op === "update")) {
      const fields = { ...last.fields, ...changed };
      if (last.op === "create") {
        for (const [name, value] of Object.entries(fields)) if (value === null) delete fields[name];
      }
      await db.outbox.update(last.seq!, { fields });
    } else {
      await db.outbox.add({
        mutationId: newMutationId(),
        recordId: id,
        op: "update",
        fields: changed,
        baseVersion: row.serverVersion,
        sentAt: null,
        attempts: 0,
        lastError: null,
      });
    }
    await db.submissions.put(next);
    return next;
  });
}

export function submitSubmission(db: TalaanDb, id: string): Promise<LocalSubmission> {
  return db.transaction("rw", db.submissions, db.outbox, async () => {
    const row = await load(db, id);
    assertEditable(row);
    const next: LocalSubmission = {
      ...row,
      status: "submitted",
      syncState: "pending",
      updatedAt: Date.now(),
    };
    await db.outbox.add({
      mutationId: newMutationId(),
      recordId: id,
      op: "submit",
      fields: {},
      baseVersion: row.serverVersion,
      sentAt: null,
      attempts: 0,
      lastError: null,
    });
    await db.submissions.put(next);
    return next;
  });
}

/** Soft delete (ADR 0006). A record the server has never heard of is simply forgotten. */
export function deleteSubmission(db: TalaanDb, id: string): Promise<void> {
  return db.transaction("rw", db.submissions, db.outbox, async () => {
    const row = await load(db, id);
    if (row.deleted) return;
    const entries = await db.outbox.where("recordId").equals(id).toArray();
    const neverSent = row.serverVersion === 0 && entries.every((e) => e.sentAt === null);
    if (neverSent) {
      await db.outbox.bulkDelete(entries.map((e) => e.seq!));
      await db.submissions.delete(id);
      return;
    }
    await db.outbox.add({
      mutationId: newMutationId(),
      recordId: id,
      op: "delete",
      fields: {},
      baseVersion: row.serverVersion,
      sentAt: null,
      attempts: 0,
      lastError: null,
    });
    await db.submissions.put({
      ...row,
      deleted: true,
      syncState: "pending",
      updatedAt: Date.now(),
    });
  });
}

/** Throw away this device's unsent changes and show the server's copy again. */
export function discardLocalChanges(db: TalaanDb, id: string): Promise<void> {
  return db.transaction("rw", db.submissions, db.outbox, async () => {
    const row = await load(db, id);
    const entries = await db.outbox.where("recordId").equals(id).toArray();
    await db.outbox.bulkDelete(entries.map((e) => e.seq!));
    if (!row.shadow) {
      await db.submissions.delete(id);
      return;
    }
    await db.submissions.put({
      ...row,
      data: { ...row.shadow.data },
      status: row.shadow.status,
      deleted: row.shadow.deleted,
      syncState: "synced",
      syncDetail: undefined,
      updatedAt: Date.now(),
    });
  });
}

export function getSubmission(db: TalaanDb, id: string): Promise<LocalSubmission | undefined> {
  return db.submissions.get(id);
}

export function listSubmissions(db: TalaanDb): Promise<LocalSubmission[]> {
  return db.submissions
    .orderBy("updatedAt")
    .reverse()
    .filter((s) => !s.deleted)
    .toArray();
}

export function pendingCount(db: TalaanDb): Promise<number> {
  return db.outbox.count();
}
