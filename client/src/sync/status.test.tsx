import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, createSubmission, dbFor } from "../db";
import { json, mockFetch } from "../test/utils";
import { SyncContext } from "./context";
import { SyncEngine } from "./engine";
import { useSyncStatus } from "./status";

afterEach(() => closeAll());

function Probe() {
  const { pending, lastSyncAt, state, syncNow } = useSyncStatus();
  return (
    <>
      <p>
        {pending} pending, {state}, {lastSyncAt ? "synced" : "never synced"}
      </p>
      <button onClick={syncNow}>Sync now</button>
    </>
  );
}

function setup() {
  const db = dbFor(1);
  const engine = new SyncEngine({ db, userId: 1, deviceId: "d" });
  const handle = {
    getStatus: engine.getStatus,
    subscribe: engine.subscribe,
    syncNow: () => engine.syncNow(),
    resume: () => engine.resume(),
    db,
  };
  render(
    <SyncContext.Provider value={handle}>
      <Probe />
    </SyncContext.Provider>,
  );
  return db;
}

describe("useSyncStatus", () => {
  it("shows nothing pending and never synced when there is no engine", () => {
    render(<Probe />);
    expect(screen.getByText("0 pending, idle, never synced")).toBeInTheDocument();
  });

  it("follows the outbox live and the engine state", async () => {
    mockFetch((request) =>
      new URL(request.url).pathname === "/api/sync/push/"
        ? (request
            .json()
            .then((body: { mutations: { mutation_id: string; record_id: string }[] }) =>
              json({
                results: body.mutations.map((m) => ({
                  mutation_id: m.mutation_id,
                  status: "applied",
                  record: {
                    id: m.record_id,
                    assignment_id: 1,
                    form_version_id: 1,
                    version: 1,
                    field_versions: {},
                    data: {},
                    status: "draft",
                    deleted: false,
                    server_seq: 1,
                  },
                })),
              }),
            ) as unknown as Response)
        : json({ results: [], records: [], next_cursor: 0, has_more: false }),
    );
    const db = setup();
    await createSubmission(db, { assignmentId: 1, formVersionId: 1 });
    await screen.findByText("1 pending, idle, never synced");

    await userEvent.setup().click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(screen.getByText("0 pending, idle, synced")).toBeInTheDocument());
  });
});
