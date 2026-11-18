import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth/AuthContext";
import { createSubmission, dbFor } from "../db";
import { SyncContext } from "../sync/context";
import type { EngineStatus } from "../sync/engine";
import { seedReference } from "../test/fixtures";
import { expectNoA11yViolations, signIn } from "../test/utils";
import { describeProblem, describeState } from "../sync/describe";
import { SyncStatusPage } from "./SyncStatusPage";

const db = () => dbFor(2);

function open(status: Partial<EngineStatus> = {}) {
  const current: EngineStatus = {
    state: "idle",
    lastSyncAt: null,
    retryAt: null,
    lastError: null,
    ...status,
  };
  const syncNow = vi.fn().mockResolvedValue("ok");
  const handle = {
    getStatus: () => current,
    subscribe: () => () => {},
    syncNow,
    resume: vi.fn(),
    db: db(),
  };
  signIn();
  const view = render(
    <AuthProvider>
      <SyncContext.Provider value={handle}>
        <MemoryRouter>
          <SyncStatusPage />
        </MemoryRouter>
      </SyncContext.Provider>
    </AuthProvider>,
  );
  return { syncNow, ...view };
}

describe("the sync status page", () => {
  it("says everything is sent when nothing is waiting", async () => {
    await seedReference();
    const { container } = open({ lastSyncAt: Date.UTC(2026, 10, 18, 8, 0) });
    expect(
      await screen.findByText("Everything that can be sent has been sent."),
    ).toBeInTheDocument();
    expect(screen.getByText("Nothing is waiting")).toBeInTheDocument();
    expect(screen.getByText("Nothing needs a decision")).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("lists what is waiting per inspection, with how often it was tried and why it failed", async () => {
    await seedReference();
    const row = await createSubmission(db(), {
      assignmentId: 1,
      formVersionId: 1,
      data: { notes: "a" },
    });
    await db().outbox.toCollection().modify({ attempts: 3, lastError: "network" });
    open({ state: "retrying", retryAt: Date.UTC(2026, 10, 18, 8, 5), lastError: "network" });

    const waiting = await screen.findByRole("region", { name: "Waiting to be sent" });
    const item = within(waiting).getByRole("listitem");
    expect(within(item).getByRole("link", { name: "North plant" })).toHaveAttribute(
      "href",
      `/submissions/${row.id}`,
    );
    expect(item).toHaveTextContent(
      "new inspection · tried 3 times · The server could not be reached.",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /The last attempt failed\. Trying again at/,
    );
    await waitFor(() =>
      expect(screen.getByText("Changes waiting to be sent").nextSibling).toHaveTextContent("1"),
    );
  });

  it("separates the inspections that need a decision", async () => {
    await seedReference();
    const row = await createSubmission(db(), {
      assignmentId: 1,
      formVersionId: 1,
      data: { notes: "mine" },
    });
    await db().outbox.clear();
    await db().submissions.update(row.id, {
      serverVersion: 1,
      syncState: "synced",
      shadow: {
        data: { notes: "start" },
        status: "draft",
        version: 1,
        fieldVersions: {},
        deleted: false,
      },
    });
    const entryRow = await createSubmission(db(), { assignmentId: 1, formVersionId: 1 });
    await db().outbox.clear();
    await db().submissions.update(entryRow.id, {
      syncState: "rejected",
      syncDetail: "The record is locked.",
    });
    open();

    const attention = await screen.findByRole("region", { name: "Needs your attention" });
    expect(within(attention).getByText(/Not accepted: The record is locked\./)).toBeInTheDocument();
    expect(within(attention).getByRole("link", { name: "North plant" })).toBeInTheDocument();
  });

  it("'Retry now' starts a sync, and is disabled while one is running", async () => {
    await seedReference();
    const { syncNow, unmount } = open();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Retry now" }));
    expect(syncNow).toHaveBeenCalledOnce();
    unmount();
    open({ state: "syncing" });
    expect(await screen.findByRole("button", { name: "Retry now" })).toBeDisabled();
  });

  it("reports the storage state in words", async () => {
    await seedReference();
    vi.stubGlobal("navigator", {
      ...navigator,
      storage: { persisted: vi.fn().mockResolvedValue(true) },
    });
    open();
    expect(await screen.findByText(/^Protected\. The browser will not clear/)).toBeInTheDocument();
  });
});

describe("describing the engine in words", () => {
  it("has a sentence for every state", () => {
    expect(describeState("syncing", 2, null)).toBe("Syncing now.");
    expect(describeState("idle", 2, null)).toBe("Waiting for the next sync.");
    expect(describeState("paused-auth", 0, null)).toMatch(/Sign in again/);
    expect(describeState("upgrade-required", 0, null)).toMatch(/too old/);
    expect(describeState("error", 0, null)).toMatch(/Retry now/);
    expect(describeState("retrying", 0, null)).toMatch(/soon/);
  });

  it("explains each problem code and never shows a raw code for the common ones", () => {
    for (const code of [
      "network",
      "timeout",
      "server_error",
      "rate_limited",
      "session_expired",
      "client_too_old",
      "local_error",
      "forbidden",
    ]) {
      expect(describeProblem(code)).not.toContain("_");
    }
    expect(describeProblem(null)).toBe("None");
    expect(describeProblem("something_new")).toBe("Problem: something_new");
  });
});
