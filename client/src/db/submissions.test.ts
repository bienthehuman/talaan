import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeAll,
  createSubmission,
  dbFor,
  deleteSubmission,
  discardLocalChanges,
  editSubmission,
  getSubmission,
  listSubmissions,
  NotEditableError,
  NotFoundError,
  pendingCount,
  submitSubmission,
  TalaanDb,
} from ".";
import type { LocalSubmission, OutboxEntry } from "./types";

afterEach(() => closeAll());

const NEW = { assignmentId: 1, formVersionId: 1 };

async function entries(db: TalaanDb, recordId?: string) {
  const all = await db.outbox.orderBy("seq").toArray();
  return recordId ? all.filter((e) => e.recordId === recordId) : all;
}

/** Pretend the server confirmed the record at `version`, so later edits are updates. */
async function confirmed(db: TalaanDb, row: LocalSubmission, version = 1) {
  await db.outbox.where("recordId").equals(row.id).delete();
  await db.submissions.put({
    ...row,
    serverVersion: version,
    syncState: "synced",
    shadow: {
      data: { ...row.data },
      status: row.status,
      version,
      fieldVersions: {},
      deleted: false,
    },
  });
}

describe("creating", () => {
  it("writes the record and a create entry together", async () => {
    const db = dbFor(1);
    const row = await createSubmission(db, { ...NEW, data: { oil_level: "ok" } });
    expect(row).toMatchObject({ status: "draft", serverVersion: 0, syncState: "pending" });
    const [entry, ...rest] = await entries(db);
    expect(entry).toBeDefined();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      recordId: row.id,
      op: "create",
      baseVersion: 0,
      assignmentId: 1,
      fields: { oil_level: "ok" },
      sentAt: null,
    });
  });

  it("keeps the client-generated id", async () => {
    const id = crypto.randomUUID();
    const row = await createSubmission(dbFor(1), { ...NEW, id });
    expect(row.id).toBe(id);
  });
});

// Scenario 12: a tab killed during a local write leaves record and outbox both present or both
// absent. IndexedDB transactions are atomic; these tests fail the second write and check that the
// first is rolled back, which is what a killed tab looks like to the database.
describe("scenario 12: record and outbox change together", () => {
  it("create: no record when the outbox write fails", async () => {
    const db = dbFor(1);
    vi.spyOn(db.outbox, "add").mockRejectedValueOnce(new Error("killed"));
    await expect(createSubmission(db, NEW)).rejects.toThrow("killed");
    expect(await db.submissions.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it("create: no outbox entry when the record write fails", async () => {
    const db = dbFor(1);
    vi.spyOn(db.submissions, "add").mockRejectedValueOnce(new Error("killed"));
    await expect(createSubmission(db, NEW)).rejects.toThrow("killed");
    expect(await db.submissions.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it("edit: the old record and entry stay when the record write fails", async () => {
    const db = dbFor(1);
    const row = await createSubmission(db, { ...NEW, data: { notes: "a" } });
    await confirmed(db, row);
    vi.spyOn(db.submissions, "put").mockRejectedValueOnce(new Error("killed"));
    await expect(editSubmission(db, row.id, { notes: "b" })).rejects.toThrow("killed");
    expect((await getSubmission(db, row.id))?.data).toEqual({ notes: "a" });
    expect(await entries(db, row.id)).toEqual([]);
  });

  it("submit and delete: both or neither", async () => {
    const db = dbFor(1);
    const row = await createSubmission(db, NEW);
    await confirmed(db, row);
    vi.spyOn(db.submissions, "put").mockRejectedValue(new Error("killed"));
    await expect(submitSubmission(db, row.id)).rejects.toThrow("killed");
    await expect(deleteSubmission(db, row.id)).rejects.toThrow("killed");
    expect(await entries(db, row.id)).toEqual([]);
    expect((await getSubmission(db, row.id))?.status).toBe("draft");
  });

  it("data survives closing and reopening the database", async () => {
    const row = await createSubmission(dbFor(1), { ...NEW, data: { oil_level: "low" } });
    closeAll();
    const reopened = new TalaanDb(1);
    expect((await reopened.submissions.get(row.id))?.data).toEqual({ oil_level: "low" });
    expect(await reopened.outbox.count()).toBe(1);
    reopened.close();
  });
});

describe("editing", () => {
  it("edits before the first push join the create entry", async () => {
    const db = dbFor(1);
    const row = await createSubmission(db, { ...NEW, data: { oil_level: "ok" } });
    await editSubmission(db, row.id, { hours_run: 5 });
    await editSubmission(db, row.id, { oil_level: "low" });
    const list = await entries(db);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ op: "create", fields: { oil_level: "low", hours_run: 5 } });
    expect((await getSubmission(db, row.id))?.data).toEqual({ oil_level: "low", hours_run: 5 });
  });

  it("clearing a field in an unsent create drops it", async () => {
    const db = dbFor(1);
    const row = await createSubmission(db, { ...NEW, data: { notes: "x", hours_run: 1 } });
    await editSubmission(db, row.id, { notes: null });
    expect((await entries(db))[0]?.fields).toEqual({ hours_run: 1 });
  });

  it("edits to a confirmed record make one update entry carrying only what changed", async () => {
    const db = dbFor(1);
    const row = await createSubmission(db, { ...NEW, data: { notes: "a", hours_run: 1 } });
    await confirmed(db, row, 3);
    await editSubmission(db, row.id, { notes: "b" });
    await editSubmission(db, row.id, { hours_run: 2 });
    await editSubmission(db, row.id, { notes: null });
    const list = await entries(db);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      op: "update",
      baseVersion: 3,
      fields: { notes: null, hours_run: 2 },
    });
    expect((await getSubmission(db, row.id))?.data).toEqual({ hours_run: 2 });
  });

  it("an entry that has been sent is never changed: a new entry follows it", async () => {
    const db = dbFor(1);
    const row = await createSubmission(db, { ...NEW, data: { notes: "a" } });
    const [sent] = (await entries(db)) as [OutboxEntry];
    await db.outbox.update(sent.seq!, { sentAt: Date.now() });
    await editSubmission(db, row.id, { notes: "b" });
    const list = await entries(db);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ mutationId: sent.mutationId, fields: { notes: "a" } });
    expect(list[1]).toMatchObject({ op: "update", fields: { notes: "b" }, baseVersion: 0 });
  });

  it("an edit that changes nothing writes nothing", async () => {
    const db = dbFor(1);
    const row = await createSubmission(db, { ...NEW, data: { notes: "a" } });
    await db.outbox.clear();
    const same = await editSubmission(db, row.id, { notes: "a", hours_run: null });
    expect(same.updatedAt).toBe(row.updatedAt);
    expect(await db.outbox.count()).toBe(0);
  });

  it("refuses edits it should not allow", async () => {
    const db = dbFor(1);
    const row = await createSubmission(db, NEW);
    await confirmed(db, row);
    await submitSubmission(db, row.id);
    await expect(editSubmission(db, row.id, { notes: "x" })).rejects.toBeInstanceOf(
      NotEditableError,
    );
    await expect(editSubmission(db, "missing", { notes: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const other = await createSubmission(db, NEW);
    await db.submissions.update(other.id, { syncState: "conflict" });
    await expect(editSubmission(db, other.id, { notes: "x" })).rejects.toBeInstanceOf(
      NotEditableError,
    );
  });
});

describe("submit and delete", () => {
  it("submit queues its own entry and marks the record submitted", async () => {
    const db = dbFor(1);
    const row = await createSubmission(db, NEW);
    await confirmed(db, row, 2);
    const next = await submitSubmission(db, row.id);
    expect(next).toMatchObject({ status: "submitted", syncState: "pending" });
    expect(await entries(db)).toMatchObject([{ op: "submit", baseVersion: 2, fields: {} }]);
  });

  it("deleting a record the server never saw forgets it and its entries", async () => {
    const db = dbFor(1);
    const row = await createSubmission(db, NEW);
    await editSubmission(db, row.id, { notes: "x" });
    await deleteSubmission(db, row.id);
    expect(await db.submissions.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it("deleting a record whose create was already sent must tell the server", async () => {
    const db = dbFor(1);
    const row = await createSubmission(db, NEW);
    const [sent] = (await entries(db)) as [OutboxEntry];
    await db.outbox.update(sent.seq!, { sentAt: Date.now() });
    await deleteSubmission(db, row.id);
    expect((await entries(db)).map((e) => e.op)).toEqual(["create", "delete"]);
  });

  it("deleting a confirmed record keeps the row as a tombstone and hides it from the list", async () => {
    const db = dbFor(1);
    const row = await createSubmission(db, NEW);
    await confirmed(db, row);
    await deleteSubmission(db, row.id);
    expect((await getSubmission(db, row.id))?.deleted).toBe(true);
    expect(await listSubmissions(db)).toEqual([]);
    expect(await entries(db)).toMatchObject([{ op: "delete", baseVersion: 1 }]);
  });
});

describe("discarding local changes", () => {
  it("restores the server copy and clears the outbox for that record", async () => {
    const db = dbFor(1);
    const row = await createSubmission(db, { ...NEW, data: { notes: "a" } });
    await confirmed(db, row);
    await editSubmission(db, row.id, { notes: "mine" });
    await discardLocalChanges(db, row.id);
    expect(await getSubmission(db, row.id)).toMatchObject({
      data: { notes: "a" },
      syncState: "synced",
    });
    expect(await db.outbox.count()).toBe(0);
  });

  it("forgets a record that was never confirmed", async () => {
    const db = dbFor(1);
    const row = await createSubmission(db, NEW);
    await discardLocalChanges(db, row.id);
    expect(await db.submissions.count()).toBe(0);
  });
});

describe("one database per user", () => {
  it("a second user on the same device never sees the first user's data", async () => {
    await createSubmission(dbFor(1), { ...NEW, data: { notes: "private" } });
    const second = dbFor(2);
    expect(await listSubmissions(second)).toEqual([]);
    expect(await pendingCount(second)).toBe(0);
    expect(await pendingCount(dbFor(1))).toBe(1);
  });
});
