import type { TalaanDb } from "./db";
import { overlay, queuedFor, reissue } from "./apply";
import type { ConflictInfo, FieldValue, LocalSubmission, OutboxEntry } from "./types";

/** Turning a person's decision about a conflict into queued work. A resolution is just another
 *  mutation (docs/protocol.md section 6): a new id, based on the version the server holds now, so
 *  the same rules and the same idempotency apply. Nothing here talks to the network. */

export class NothingToResolveError extends Error {}
/** A choice is missing: a decision cannot be applied half made. */
export class IncompleteResolutionError extends Error {}

export type FieldChoice = "mine" | "theirs";

export interface FieldConflictView {
  field: string;
  /** What the field held before this device's first edit (null: it was not set). */
  start: FieldValue | undefined;
  mine: FieldValue;
  theirs: FieldValue;
}

export interface ConflictView {
  kind: ConflictInfo["kind"];
  fields: FieldConflictView[];
  /** Changes of this device that do not clash and will go out with the resolution. */
  carried: { field: string; value: FieldValue }[];
}

async function blockedEntry(db: TalaanDb, row: LocalSubmission): Promise<OutboxEntry> {
  const queued = await queuedFor(db, row.id);
  const entry = queued.find((e) => e.lastError?.startsWith("conflict:")) ?? queued[0];
  if (!entry) throw new NothingToResolveError();
  return entry;
}

async function loadConflicted(db: TalaanDb, id: string, kind: ConflictInfo["kind"]) {
  const row = await db.submissions.get(id);
  if (!row || row.syncState !== "conflict" || row.conflict?.kind !== kind || !row.shadow) {
    throw new NothingToResolveError();
  }
  return { row, shadow: row.shadow, conflict: row.conflict };
}

/** What the conflict screen shows. Null when the record is not in conflict. */
export async function loadConflict(db: TalaanDb, id: string): Promise<ConflictView | null> {
  const row = await db.submissions.get(id);
  if (!row || row.syncState !== "conflict" || !row.conflict || !row.shadow) return null;
  const entry = await blockedEntry(db, row).catch(() => null);
  const clashing = new Set(row.conflict.fields.map((f) => f.field));
  return {
    kind: row.conflict.kind,
    fields: row.conflict.fields.map((f) => ({
      field: f.field,
      start: entry?.before?.[f.field],
      mine: f.field in row.data ? row.data[f.field]! : null,
      theirs: f.field in row.shadow!.data ? row.shadow!.data[f.field]! : null,
    })),
    carried: Object.entries(entry?.fields ?? {})
      .filter(([name]) => !clashing.has(name) && entry?.op === "update")
      .map(([field, value]) => ({ field, value })),
  };
}

/** Two devices changed the same field. For every clashing field the person keeps theirs or takes the
 *  server's. Their other changes go out as before; fields they give up are dropped everywhere. */
export function resolveFieldConflict(
  db: TalaanDb,
  id: string,
  choices: Record<string, FieldChoice>,
): Promise<void> {
  return db.transaction("rw", db.submissions, db.outbox, async () => {
    const { row, shadow, conflict } = await loadConflicted(db, id, "field_conflict");
    const clashing = conflict.fields.map((f) => f.field);
    if (clashing.some((name) => choices[name] !== "mine" && choices[name] !== "theirs")) {
      throw new IncompleteResolutionError();
    }
    const giveUp = new Set(clashing.filter((name) => choices[name] === "theirs"));
    const blocked = await blockedEntry(db, row);

    for (const entry of await queuedFor(db, id)) {
      const fields = Object.fromEntries(
        Object.entries(entry.fields).filter(([name]) => !giveUp.has(name)),
      );
      const emptied = entry.op === "update" && Object.keys(fields).length === 0;
      if (emptied) {
        await db.outbox.delete(entry.seq!);
        continue;
      }
      // Based on the server's current version: the person has now seen it. The entry the server
      // answered with a conflict is sent again as a new mutation (its old id's answer is the conflict).
      const rebase = { fields, baseVersion: shadow.version };
      if (entry.seq === blocked.seq) await reissue(db, entry, rebase);
      else await db.outbox.update(entry.seq!, rebase);
    }
    await settle(db, row);
  });
}

/** The record was deleted on the server while this device edited it. Discarding is
 *  `discardLocalChanges`; waiting needs no call, because a pull that brings the record back (an admin
 *  restored it) queues the edits again (`applyPull`). */

/** This device deleted a record that others edited after its base. Keep the record, or delete it
 *  anyway (sent again as a new delete based on the current version). */
export function resolveEditedSinceBase(
  db: TalaanDb,
  id: string,
  choice: "keep" | "delete",
): Promise<void> {
  return db.transaction("rw", db.submissions, db.outbox, async () => {
    const { row, shadow } = await loadConflicted(db, id, "edited_since_base");
    const blocked = await blockedEntry(db, row);
    if (choice === "keep") {
      await db.outbox.delete(blocked.seq!);
    } else {
      await reissue(db, blocked, { baseVersion: shadow.version });
    }
    await settle(db, row);
  });
}

/** Show the server's copy with whatever is still queued on top, and say whether anything is left. */
async function settle(db: TalaanDb, row: LocalSubmission): Promise<void> {
  const shadow = row.shadow!;
  const queued = await queuedFor(db, row.id);
  await db.submissions.put({
    ...row,
    ...overlay(shadow, queued),
    serverVersion: shadow.version,
    fieldVersions: shadow.fieldVersions,
    syncState: queued.length > 0 ? "pending" : "synced",
    syncDetail: undefined,
    conflict: undefined,
    updatedAt: Date.now(),
  });
}
