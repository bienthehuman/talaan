import { describe, expect, it } from "vitest";
import {
  applyPull,
  applyResult,
  createSubmission,
  dbFor,
  deleteSubmission,
  discardLocalChanges,
  editSubmission,
  getSubmission,
  IncompleteResolutionError,
  loadConflict,
  NothingToResolveError,
  resolveEditedSinceBase,
  resolveFieldConflict,
  takeBatch,
  type ConflictInfo,
  type ServerRecord,
} from ".";

const NEW = { assignmentId: 1, formVersionId: 1 };
const db = () => dbFor(1);

function server(id: string, version: number, data: object, extra: Partial<ServerRecord> = {}) {
  return {
    id,
    assignment_id: 1,
    form_version_id: 1,
    version,
    field_versions: {},
    data,
    status: "draft",
    deleted: false,
    server_seq: 100 + version,
    ...extra,
  } as ServerRecord;
}

/** A record the server holds at version 1, which this device then edits (like a real session). */
async function confirmedRecord(data: object) {
  const row = await createSubmission(db(), { ...NEW, data: data as never });
  await db().outbox.clear();
  await db().submissions.update(row.id, {
    serverVersion: 1,
    syncState: "synced",
    shadow: {
      data: { ...row.data },
      status: "draft",
      version: 1,
      fieldVersions: {},
      deleted: false,
    },
  });
  return row.id;
}

/** Send the oldest entry and have the server answer with this conflict, as the engine would. */
async function answerWithConflict(conflict: ConflictInfo, theirs: ServerRecord) {
  const [entry] = await takeBatch(db());
  await applyResult(db(), entry!, {
    mutation_id: entry!.mutationId,
    status: "conflict",
    conflict,
    record: theirs,
  });
  return entry!;
}

const clash = (field: string, server_value: string, server_version = 2): ConflictInfo => ({
  kind: "field_conflict",
  fields: [{ field, server_value, server_version }],
});

async function queued() {
  return db().outbox.orderBy("seq").toArray();
}

describe("the starting value", () => {
  it("is what the field held before the first unsent edit, however often it is edited", async () => {
    const id = await confirmedRecord({ notes: "start", hours_run: 1 });
    await editSubmission(db(), id, { notes: "one" });
    await editSubmission(db(), id, { notes: "two", hours_run: 2 });
    await editSubmission(db(), id, { site_contact: "Ana" });
    expect((await queued())[0]!.before).toEqual({
      notes: "start",
      hours_run: 1,
      site_contact: null,
    });
  });
});

describe("a field conflict", () => {
  async function setup() {
    const id = await confirmedRecord({ notes: "start", oil_level: "ok" });
    await editSubmission(db(), id, { notes: "mine", hours_run: 7 });
    const original = await answerWithConflict(
      clash("notes", "theirs"),
      server(id, 2, { notes: "theirs", oil_level: "ok" }),
    );
    return { id, original };
  }

  it("is described with the starting value, mine, theirs and what is carried over", async () => {
    const { id } = await setup();
    expect(await loadConflict(db(), id)).toEqual({
      kind: "field_conflict",
      fields: [{ field: "notes", start: "start", mine: "mine", theirs: "theirs" }],
      carried: [{ field: "hours_run", value: 7 }],
    });
  });

  it("keeping mine sends everything again as one new mutation on the current version", async () => {
    const { id, original } = await setup();
    await resolveFieldConflict(db(), id, { notes: "mine" });

    const [entry, ...rest] = await queued();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      op: "update",
      fields: { notes: "mine", hours_run: 7 },
      baseVersion: 2, // the server's version now, which the person has seen
      sentAt: null,
      attempts: 0,
      lastError: null,
    });
    expect(entry!.mutationId).not.toBe(original.mutationId); // the old id's answer is the conflict
    expect(await getSubmission(db(), id)).toMatchObject({
      syncState: "pending",
      data: { notes: "mine", oil_level: "ok", hours_run: 7 },
      serverVersion: 2,
    });
    expect((await getSubmission(db(), id))!.conflict).toBeUndefined();
  });

  it("taking theirs drops that field and still sends the rest", async () => {
    const { id } = await setup();
    await resolveFieldConflict(db(), id, { notes: "theirs" });
    expect((await queued())[0]).toMatchObject({ fields: { hours_run: 7 }, baseVersion: 2 });
    expect((await getSubmission(db(), id))!.data).toEqual({
      notes: "theirs",
      oil_level: "ok",
      hours_run: 7,
    });
  });

  it("taking theirs for everything with nothing else to send leaves the record synced", async () => {
    const id = await confirmedRecord({ notes: "start" });
    await editSubmission(db(), id, { notes: "mine" });
    await answerWithConflict(clash("notes", "theirs"), server(id, 2, { notes: "theirs" }));
    await resolveFieldConflict(db(), id, { notes: "theirs" });

    expect(await queued()).toEqual([]);
    expect(await getSubmission(db(), id)).toMatchObject({
      syncState: "synced",
      data: { notes: "theirs" },
    });
  });

  it("a field given up is dropped from changes queued behind it too, and they are rebased", async () => {
    const id = await confirmedRecord({ notes: "start" });
    await editSubmission(db(), id, { notes: "mine" });
    const [sent] = await takeBatch(db()); // on its way to the server...
    await editSubmission(db(), id, { notes: "mine again", hours_run: 3 }); // ...when the person edits more
    await applyResult(db(), sent!, {
      mutation_id: sent!.mutationId,
      status: "conflict",
      conflict: clash("notes", "theirs"),
      record: server(id, 2, { notes: "theirs" }),
    });
    await resolveFieldConflict(db(), id, { notes: "theirs" });

    const entries = await queued();
    expect(entries.map((e) => e.fields)).toEqual([{ hours_run: 3 }]);
    expect(entries[0]!.baseVersion).toBe(2);
  });

  it("is refused while a choice is missing, and changes nothing", async () => {
    const { id, original } = await setup();
    await expect(resolveFieldConflict(db(), id, {})).rejects.toBeInstanceOf(
      IncompleteResolutionError,
    );
    expect((await queued())[0]!.mutationId).toBe(original.mutationId);
    expect((await getSubmission(db(), id))!.syncState).toBe("conflict");
  });

  it("is refused for a record that is not in conflict", async () => {
    const id = await confirmedRecord({ notes: "x" });
    await expect(resolveFieldConflict(db(), id, { notes: "mine" })).rejects.toBeInstanceOf(
      NothingToResolveError,
    );
  });
});

describe("a record deleted on the server while this device edited it", () => {
  async function setup() {
    const id = await confirmedRecord({ notes: "start" });
    await editSubmission(db(), id, { notes: "mine" });
    const original = await answerWithConflict(
      { kind: "deleted_remotely", fields: [] },
      server(id, 2, { notes: "start" }, { deleted: true }),
    );
    return { id, original };
  }

  it("keeps the edits and waits while nothing changes", async () => {
    const { id } = await setup();
    expect(await getSubmission(db(), id)).toMatchObject({
      syncState: "conflict",
      data: { notes: "mine" },
    });
    expect(await queued()).toHaveLength(1);
  });

  it("discarding drops the edits and hides the record", async () => {
    const { id } = await setup();
    await discardLocalChanges(db(), id);
    expect(await queued()).toEqual([]);
    expect(await getSubmission(db(), id)).toMatchObject({ deleted: true, syncState: "synced" });
  });

  it("when an admin restores it, the edits are queued again under a new id on the same base", async () => {
    const { id, original } = await setup();
    await applyPull(db(), [server(id, 3, { notes: "start" })], 103); // restored: version 3, not deleted

    const [entry, ...rest] = await queued();
    expect(rest).toEqual([]);
    expect(entry!.mutationId).not.toBe(original.mutationId);
    expect(entry).toMatchObject({ fields: { notes: "mine" }, baseVersion: 1, sentAt: null });
    const row = (await getSubmission(db(), id))!;
    expect(row).toMatchObject({ syncState: "pending", deleted: false, data: { notes: "mine" } });
    expect(row.conflict).toBeUndefined();
  });

  it("a pull that brings nothing new leaves the waiting edits alone", async () => {
    const { id, original } = await setup();
    await applyPull(db(), [server(id, 2, {}, { deleted: true })], 102); // the same delete again
    expect((await queued())[0]!.mutationId).toBe(original.mutationId);
    expect((await getSubmission(db(), id))!.syncState).toBe("conflict");
  });
});

describe("deleting a record that others edited since", () => {
  async function setup() {
    const id = await confirmedRecord({ notes: "start" });
    await deleteSubmission(db(), id);
    const original = await answerWithConflict(
      {
        kind: "edited_since_base",
        fields: [{ field: "notes", server_value: "theirs", server_version: 2 }],
      },
      server(id, 2, { notes: "theirs" }),
    );
    return { id, original };
  }

  it("shows the record again while the person decides, so the decision can be reached", async () => {
    const { id } = await setup();
    expect(await getSubmission(db(), id)).toMatchObject({ deleted: false, syncState: "conflict" });
  });

  it("keeping the record drops the delete and shows the server's copy", async () => {
    const { id } = await setup();
    await resolveEditedSinceBase(db(), id, "keep");
    expect(await queued()).toEqual([]);
    expect(await getSubmission(db(), id)).toMatchObject({
      deleted: false,
      syncState: "synced",
      data: { notes: "theirs" },
    });
  });

  it("deleting anyway sends a new delete on the current version", async () => {
    const { id, original } = await setup();
    await resolveEditedSinceBase(db(), id, "delete");
    const [entry] = await queued();
    expect(entry).toMatchObject({ op: "delete", baseVersion: 2, sentAt: null });
    expect(entry!.mutationId).not.toBe(original.mutationId);
    expect(await getSubmission(db(), id)).toMatchObject({ deleted: true, syncState: "pending" });
  });
});
