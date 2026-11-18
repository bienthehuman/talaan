import Dexie, { type EntityTable } from "dexie";
import type { LocalSubmission, MetaRow, OutboxEntry } from "./types";

/** Reference data downloaded for offline use; the shapes come from the API types. */
export interface LocalAssignment {
  id: number;
  [key: string]: unknown;
}
export interface LocalFormVersion {
  id: number;
  [key: string]: unknown;
}

export class TalaanDb extends Dexie {
  submissions!: EntityTable<LocalSubmission, "id">;
  outbox!: EntityTable<OutboxEntry, "seq">;
  assignments!: EntityTable<LocalAssignment, "id">;
  formVersions!: EntityTable<LocalFormVersion, "id">;
  meta!: EntityTable<MetaRow, "key">;

  constructor(userId: number) {
    super(`talaan-user-${userId}`);
    // Only indexed fields are listed. Add a new `.version(n)` with an upgrade; never edit version 1.
    this.version(1).stores({
      submissions: "id, assignmentId, syncState, updatedAt",
      outbox: "++seq, mutationId, recordId, sentAt",
      assignments: "id",
      formVersions: "id",
      meta: "key",
    });
  }
}

const open = new Map<number, TalaanDb>();

/** The database for one user. Same instance for the life of the page. */
export function dbFor(userId: number): TalaanDb {
  let db = open.get(userId);
  if (!db) {
    db = new TalaanDb(userId);
    open.set(userId, db);
  }
  return db;
}

/** Remove one user's local database from this device (sign-out). */
export async function deleteDbFor(userId: number): Promise<void> {
  const db = open.get(userId);
  open.delete(userId);
  if (db) db.close();
  await Dexie.delete(`talaan-user-${userId}`);
}

/** Test and sign-out helper: close and forget the cached instances. */
export function closeAll(): void {
  for (const db of open.values()) db.close();
  open.clear();
}
