import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyPull,
  closeAll,
  createSubmission,
  dbFor,
  deleteSubmission,
  editSubmission,
  getSubmission,
  type PushResult,
  type ServerRecord,
} from "../db";
import { json, mockFetch } from "../test/utils";
import { backoffMs } from "./backoff";
import { SyncEngine } from "./engine";

afterEach(() => {
  closeAll();
  vi.useRealTimers();
});

const NEW = { assignmentId: 1, formVersionId: 1 };

interface PushBody {
  device_id: string;
  client_schema: number;
  mutations: {
    mutation_id: string;
    record_id: string;
    op: string;
    base_version: number;
    fields: object;
  }[];
}

function record(
  id: string,
  version: number,
  data = {},
  extra: Partial<ServerRecord> = {},
): ServerRecord {
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
  };
}

/** A scripted server. `push` decides each push; `pull` serves pages in order. */
function server(
  opts: {
    push?: (body: PushBody) => Response;
    pull?: (cursor: number) => Response;
  } = {},
) {
  const pushes: PushBody[] = [];
  const pulls: number[] = [];
  const fetch = mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/sync/push/") {
      return request.json().then((body: PushBody) => {
        pushes.push(body);
        return opts.push ? opts.push(body) : json({ results: allApplied(body) });
      }) as unknown as Response;
    }
    if (url.pathname === "/api/sync/pull/") {
      const cursor = Number(url.searchParams.get("cursor"));
      pulls.push(cursor);
      return opts.pull
        ? opts.pull(cursor)
        : json({ records: [], next_cursor: cursor, has_more: false });
    }
    return json({ results: [] });
  });
  return { fetch, pushes, pulls };
}

let versions = new Map<string, number>();
/** Accept every mutation: creates land at version 1, later ones one above what was last accepted. */
function allApplied(body: PushBody): PushResult[] {
  return body.mutations.map((m) => {
    const version = (versions.get(m.record_id) ?? 0) + 1;
    versions.set(m.record_id, version);
    return {
      mutation_id: m.mutation_id,
      status: "applied",
      record: record(m.record_id, version, m.fields as never),
    };
  });
}

function engine(userId = 1, random = () => 0.5) {
  versions = new Map();
  return new SyncEngine({ db: dbFor(userId), userId, deviceId: "dev-1", random });
}

async function outboxIds() {
  return (await dbFor(1).outbox.orderBy("seq").toArray()).map((e) => e.mutationId);
}

describe("a cycle", () => {
  it("sends the outbox and applies the results", async () => {
    const db = dbFor(1);
    const s = server();
    const row = await createSubmission(db, { ...NEW, data: { oil_level: "ok" } });
    const sync = engine();

    expect(await sync.syncNow()).toBe("ok");

    expect(s.pushes).toHaveLength(1);
    expect(s.pushes[0]).toMatchObject({
      device_id: "dev-1",
      client_schema: 1,
      mutations: [
        { record_id: row.id, op: "create", base_version: 0, fields: { oil_level: "ok" } },
      ],
    });
    expect(await db.outbox.count()).toBe(0);
    expect(await getSubmission(db, row.id)).toMatchObject({
      syncState: "synced",
      serverVersion: 1,
      shadow: { version: 1, data: { oil_level: "ok" } },
    });
    expect(sync.getStatus()).toMatchObject({ state: "idle", lastError: null });
    expect(sync.getStatus().lastSyncAt).not.toBeNull();
  });

  it("downloads assignments and form versions", async () => {
    mockFetch((request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/assignments/")) return json({ results: [{ id: 7, site_name: "North" }] });
      if (path.endsWith("/form-versions/")) return json({ results: [{ id: 3, schema: {} }] });
      return json({ records: [], next_cursor: 0, has_more: false });
    });
    await engine().syncNow();
    expect((await dbFor(1).assignments.toArray()).map((a) => a.id)).toEqual([7]);
    expect((await dbFor(1).formVersions.toArray()).map((f) => f.id)).toEqual([3]);
  });

  it("sends at most 50 mutations, and one entry per record, in order", async () => {
    const db = dbFor(1);
    const s = server();
    const rows: Awaited<ReturnType<typeof createSubmission>>[] = [];
    for (let i = 0; i < 60; i++) rows.push(await createSubmission(db, NEW));
    // A second change to the first record must wait for the first to be answered.
    const first = (await db.outbox.orderBy("seq").first())!;
    await db.outbox.update(first.seq!, { sentAt: 1 });
    await editSubmission(db, rows[0]!.id, { notes: "later" });

    await engine().syncNow();

    expect(s.pushes.map((p) => p.mutations.length)).toEqual([50, 11]);
    const second = s.pushes[1]!.mutations.filter((m) => m.record_id === rows[0]!.id);
    expect(second.map((m) => m.op)).toEqual(["update"]);
    expect(await db.outbox.count()).toBe(0);
  });

  it("rebases a queued entry onto the version the server just assigned", async () => {
    const db = dbFor(1);
    const s = server();
    const row = await createSubmission(db, { ...NEW, data: { notes: "a" } });
    await db.outbox.toCollection().modify({ sentAt: 1 }); // already sent once: now frozen
    await editSubmission(db, row.id, { notes: "b" }); // queued behind it, base 0
    await engine().syncNow();

    expect(s.pushes[1]!.mutations[0]).toMatchObject({
      op: "update",
      base_version: 1,
      fields: { notes: "b" },
    });
    expect(await getSubmission(db, row.id)).toMatchObject({
      data: { notes: "b" },
      syncState: "synced",
    });
  });

  it("does not rebase when someone else wrote in between", async () => {
    const db = dbFor(1);
    const row = await createSubmission(db, { ...NEW, data: { notes: "a" } });
    await db.outbox.toCollection().modify({ sentAt: 1 });
    await editSubmission(db, row.id, { notes: "b" });
    const s = server({
      push: (body) => {
        // The create is accepted at version 3: two other changes landed first.
        const m = body.mutations[0]!;
        if (m.op === "create") {
          return json({
            results: [{ mutation_id: m.mutation_id, status: "applied", record: record(row.id, 3) }],
          });
        }
        return json({
          results: [{ mutation_id: m.mutation_id, status: "applied", record: record(row.id, 4) }],
        });
      },
    });
    await engine().syncNow();
    expect(s.pushes[1]!.mutations[0]!.base_version).toBe(0);
  });
});

describe("verdicts that are not retried", () => {
  it("a conflict keeps the user's data and entry, remembers the server copy, and is not resent", async () => {
    const db = dbFor(1);
    const row = await createSubmission(db, { ...NEW, data: { notes: "mine" } });
    await db.submissions.update(row.id, { serverVersion: 1 });
    const conflict = {
      kind: "field_conflict" as const,
      fields: [{ field: "notes", server_value: "theirs", client_value: "mine", server_version: 2 }],
    };
    const s = server({
      push: (body) =>
        json({
          results: [
            {
              mutation_id: body.mutations[0]!.mutation_id,
              status: "conflict",
              conflict,
              record: record(row.id, 2, { notes: "theirs" }),
            },
          ],
        }),
    });
    const sync = engine();
    expect(await sync.syncNow()).toBe("ok");
    const stored = await getSubmission(db, row.id);
    expect(stored).toMatchObject({
      syncState: "conflict",
      syncDetail: "field_conflict",
      data: { notes: "mine" },
      shadow: { data: { notes: "theirs" }, version: 2 },
      conflict,
    });
    expect(await db.outbox.count()).toBe(1);

    await sync.syncNow();
    expect(s.pushes).toHaveLength(1); // nothing more to send for that record
  });

  it("a rejection marks the record with the reason and is never retried", async () => {
    const db = dbFor(1);
    const row = await createSubmission(db, NEW);
    const s = server({
      push: (body) =>
        json({
          results: [
            {
              mutation_id: body.mutations[0]!.mutation_id,
              status: "rejected",
              code: "locked",
              detail: "The record is approved and locked.",
            },
          ],
        }),
    });
    const sync = engine();
    await sync.syncNow();
    expect(await getSubmission(db, row.id)).toMatchObject({
      syncState: "rejected",
      syncDetail: "The record is approved and locked.",
    });
    await sync.syncNow();
    expect(s.pushes).toHaveLength(1);
  });
});

describe("failures", () => {
  const cases: [string, () => void, number?][] = [
    [
      "network error",
      () => vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))),
    ],
    [
      "timeout",
      () =>
        vi.stubGlobal(
          "fetch",
          vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")),
        ),
    ],
    ["500", () => void mockFetch(() => json({ code: "server_error" }, 500))],
    ["503", () => void mockFetch(() => json({ code: "database_unavailable" }, 503))],
    [
      "429",
      () =>
        void mockFetch(() =>
          json({ code: "rate_limited", retry_after: 7 }, 429, { "Retry-After": "7" }),
        ),
      7000,
    ],
  ];

  it.each(cases)(
    "%s: nothing is lost and the same mutation is retried",
    async (_name, fail, minWait = 0) => {
      const db = dbFor(1);
      await createSubmission(db, { ...NEW, data: { notes: "a" } });
      const [before] = await db.outbox.toArray();
      const sync = engine(1, () => 0.5);

      fail();
      expect(await sync.syncNow()).toBe("transient");
      const after = (await db.outbox.toArray())[0]!;
      expect(after).toMatchObject({
        mutationId: before!.mutationId,
        attempts: 1,
        fields: { notes: "a" },
      });
      expect(after.sentAt).not.toBeNull();
      const status = sync.getStatus();
      expect(status.state).toBe("retrying");
      expect(status.retryAt! - Date.now()).toBeGreaterThanOrEqual(minWait - 50);
      sync.stop();

      // The server did commit it last time, and the answer was lost. The retry is the same mutation.
      const s = server();
      expect(await sync.syncNow()).toBe("ok");
      expect(s.pushes[0]!.mutations[0]!.mutation_id).toBe(before!.mutationId);
      expect(await db.outbox.count()).toBe(0);
      sync.stop();
    },
  );

  it("401 pauses the cycle, leaves the outbox untouched, and automatic triggers stay quiet", async () => {
    const db = dbFor(1);
    await createSubmission(db, NEW);
    const ids = await outboxIds();
    const fetch = mockFetch(() => json({ code: "unauthenticated" }, 401));
    const sync = engine();

    expect(await sync.syncNow()).toBe("auth");
    expect(sync.getStatus().state).toBe("paused-auth");
    expect(await outboxIds()).toEqual(ids);
    const calls = fetch.mock.calls.length;

    sync.start();
    window.dispatchEvent(new Event("online"));
    await Promise.resolve();
    expect(fetch.mock.calls.length).toBe(calls);

    const s = server();
    expect(await sync.resume()).toBe("ok");
    expect(s.pushes).toHaveLength(1);
    sync.stop();
  });

  it("426 stops syncing and keeps local data", async () => {
    const db = dbFor(1);
    const row = await createSubmission(db, { ...NEW, data: { notes: "keep" } });
    mockFetch(() => json({ code: "client_too_old" }, 426));
    const sync = engine();
    expect(await sync.syncNow()).toBe("upgrade");
    expect(sync.getStatus().state).toBe("upgrade-required");
    expect((await getSubmission(db, row.id))?.data).toEqual({ notes: "keep" });
    expect(await db.outbox.count()).toBe(1);
  });

  it("an unexpected 4xx is fatal, not retried forever", async () => {
    await createSubmission(dbFor(1), NEW);
    mockFetch(() => json({ code: "forbidden" }, 403));
    const sync = engine();
    expect(await sync.syncNow()).toBe("fatal");
    expect(sync.getStatus()).toMatchObject({ state: "error", lastError: "forbidden" });
  });
});

describe("pull", () => {
  it("stores new records and advances the cursor with them", async () => {
    const db = dbFor(1);
    const s = server({
      pull: (cursor) =>
        json(
          cursor === 0
            ? {
                records: [record("r1", 1, { notes: "x" }, { server_seq: 5 })],
                next_cursor: 5,
                has_more: true,
              }
            : {
                records: [record("r2", 1, {}, { server_seq: 9 })],
                next_cursor: 9,
                has_more: false,
              },
        ),
    });
    await engine().syncNow();
    expect(s.pulls).toEqual([0, 5]);
    expect((await db.submissions.toArray()).map((r) => r.id).sort()).toEqual(["r1", "r2"]);
    expect((await db.meta.get("syncCursor"))?.value).toBe(9);
  });

  it("keeps the cursor of the last page that was stored when a later page fails", async () => {
    const db = dbFor(1);
    server({
      pull: (cursor) =>
        cursor === 0
          ? json({
              records: [record("r1", 1, {}, { server_seq: 5 })],
              next_cursor: 5,
              has_more: true,
            })
          : json({ code: "server_error" }, 500),
    });
    const sync = engine();
    expect(await sync.syncNow()).toBe("transient");
    expect((await db.meta.get("syncCursor"))?.value).toBe(5);
    expect(await db.submissions.count()).toBe(1);
    sync.stop();
  });

  it("ignores a record at or below the version already held (at-least-once)", async () => {
    const db = dbFor(1);
    const row = await createSubmission(db, { ...NEW, data: { notes: "new" } });
    await db.outbox.clear();
    await db.submissions.update(row.id, { serverVersion: 3, syncState: "synced" });
    server({
      pull: () =>
        json({ records: [record(row.id, 3, { notes: "old" })], next_cursor: 103, has_more: false }),
    });
    await engine().syncNow();
    expect((await getSubmission(db, row.id))?.data).toEqual({ notes: "new" });
  });

  it("updates the shadow without touching unsent edits", async () => {
    const db = dbFor(1);
    const row = await createSubmission(db, { ...NEW, data: { notes: "a", hours_run: 1 } });
    await db.outbox.clear();
    await db.submissions.update(row.id, { serverVersion: 1, syncState: "synced" });
    await editSubmission(db, row.id, { notes: "mine" }); // unsent
    // Drive applyPull directly: a full cycle would push the edit first.
    await applyPull(db, [record(row.id, 2, { notes: "theirs", hours_run: 9 })], 102);
    const stored = (await getSubmission(db, row.id))!;
    expect(stored.shadow).toMatchObject({ version: 2, data: { notes: "theirs", hours_run: 9 } });
    expect(stored.data).toEqual({ notes: "mine", hours_run: 9 }); // mine kept, theirs merged in
    expect(stored.serverVersion).toBe(2);
    expect(stored.syncState).toBe("pending");
  });

  it("a record deleted remotely stays visible while the user has queued edits", async () => {
    const db = dbFor(1);
    const row = await createSubmission(db, { ...NEW, data: { notes: "a" } });
    await db.outbox.clear();
    await db.submissions.update(row.id, { serverVersion: 1, syncState: "synced" });
    await editSubmission(db, row.id, { notes: "mine" });
    // Drive applyPull directly: the push in a full cycle would report the conflict first.
    await applyPull(db, [record(row.id, 2, { notes: "a" }, { deleted: true })], 102);
    expect(await getSubmission(db, row.id)).toMatchObject({
      deleted: false,
      data: { notes: "mine" },
    });
    expect((await getSubmission(db, row.id))!.shadow!.deleted).toBe(true);
  });

  it("a remote delete with nothing queued hides the record", async () => {
    const db = dbFor(1);
    const row = await createSubmission(db, NEW);
    await db.outbox.clear();
    await db.submissions.update(row.id, { serverVersion: 1, syncState: "synced" });
    await applyPull(db, [record(row.id, 2, {}, { deleted: true })], 102);
    expect((await getSubmission(db, row.id))!.deleted).toBe(true);
  });

  it("a tombstone for a record this device never had is not stored", async () => {
    const db = dbFor(1);
    server({
      pull: () =>
        json({
          records: [record("ghost", 2, {}, { deleted: true })],
          next_cursor: 102,
          has_more: false,
        }),
    });
    await engine().syncNow();
    expect(await db.submissions.count()).toBe(0);
  });
});

describe("one sync at a time", () => {
  it("a second engine on the same database does nothing while the first runs", async () => {
    const db = dbFor(1);
    await createSubmission(db, NEW);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const s = server({});
    const base = s.fetch.getMockImplementation()!;
    s.fetch.mockImplementation(async (request: Request) => {
      await gate;
      return base(request);
    });
    const a = engine();
    const b = new SyncEngine({ db, userId: 1, deviceId: "dev-2" });

    const first = a.syncNow();
    expect(await b.syncNow()).toBe("busy");
    release();
    expect(await first).toBe("ok");
    expect(s.pushes).toHaveLength(1);
  });

  it("calls made while a cycle runs share it", async () => {
    await createSubmission(dbFor(1), NEW);
    const s = server();
    const sync = engine();
    const [x, y] = await Promise.all([sync.syncNow(), sync.syncNow()]);
    expect([x, y]).toEqual(["ok", "ok"]);
    expect(s.pushes).toHaveLength(1);
  });
});

describe("triggers", () => {
  it("syncs on start, when the browser comes online, and every 60 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const s = server();
    const sync = engine();
    sync.start();
    await vi.waitFor(() => expect(s.pulls).toHaveLength(1));

    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(s.pulls).toHaveLength(2));

    vi.advanceTimersByTime(60_000);
    await vi.waitFor(() => expect(s.pulls).toHaveLength(3));
    sync.stop();
  });
});

describe("backoff", () => {
  it("grows exponentially, is jittered, and is capped", () => {
    expect(backoffMs(1, 0, () => 1)).toBe(1000);
    expect(backoffMs(2, 0, () => 1)).toBe(2000);
    expect(backoffMs(3, 0, () => 1)).toBe(4000);
    expect(backoffMs(20, 0, () => 1)).toBe(60_000);
    expect(backoffMs(4, 0, () => 0.5)).toBe(4000);
    expect(backoffMs(4, 0, () => 0)).toBe(0);
  });

  it("never waits less than the server asked for", () => {
    expect(backoffMs(1, 30_000, () => 0)).toBe(30_000);
  });
});

describe("a deleted record", () => {
  it("sends the delete and keeps the tombstone", async () => {
    const db = dbFor(1);
    const row = await createSubmission(db, NEW);
    server();
    await engine().syncNow(); // create applied
    await deleteSubmission(db, row.id);
    const s = server({
      push: (body) =>
        json({
          results: [
            {
              mutation_id: body.mutations[0]!.mutation_id,
              status: "applied",
              record: record(row.id, 2, {}, { deleted: true }),
            },
          ],
        }),
    });
    await engine().syncNow();
    expect(s.pushes[0]!.mutations[0]).toMatchObject({ op: "delete", base_version: 1 });
    expect(await getSubmission(db, row.id)).toMatchObject({ deleted: true, syncState: "synced" });
  });
});
