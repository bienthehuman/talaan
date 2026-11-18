import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Dexie from "dexie";
import { createSubmission, dbFor } from "../db";
import { whenWiped } from "../auth/wipe";
import { getSession } from "../auth/session";
import { renderApp, signIn } from "../test/utils";

// Stub the sync status so there are unsent changes .
const status = vi.hoisted(() => ({ pending: 3, conflicts: 0 }));
vi.mock("../sync/status", () => ({
  useSyncStatus: () => ({
    pending: status.pending,
    conflicts: status.conflicts,
    lastSyncAt: null,
    state: "idle",
    syncNow: () => {},
    resume: () => {},
    lastError: null,
  }),
}));

beforeEach(() => {
  status.pending = 3;
  status.conflicts = 0;
});

afterEach(() => whenWiped()); // a sign-out's data removal must not run into the next test

describe("signing out with unsent changes", () => {
  it("asks first and keeps the session when cancelled", async () => {
    signIn();
    renderApp("/");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    const dialog = screen.getByRole("dialog", { name: "Sign out with unsent changes?" });
    expect(dialog).toHaveTextContent("3 changes are saved only on this device");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(getSession()).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Assignments" })).toBeInTheDocument();
  });

  it("signs out only after the destructive confirmation", async () => {
    signIn();
    renderApp("/");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await user.click(screen.getByRole("button", { name: "Sign out and delete" }));

    expect(getSession()).toBeNull();
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("uses the singular for one unsent change", async () => {
    status.pending = 1;
    signIn();
    renderApp("/");
    await userEvent.setup().click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "1 change is saved only on this device. Signing out will delete it.",
    );
  });
});

describe("signing out removes the person's data from the device", () => {
  it("deletes only their local database, and only after they confirm", async () => {
    signIn(); // user id 2
    await createSubmission(dbFor(2), { assignmentId: 1, formVersionId: 1 });
    await createSubmission(dbFor(3), { assignmentId: 1, formVersionId: 1 });
    renderApp("/");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await Dexie.exists("talaan-user-2")).toBe(true); // asked first; nothing deleted yet
    await user.click(screen.getByRole("button", { name: "Sign out and delete" }));

    await vi.waitFor(async () => expect(await Dexie.exists("talaan-user-2")).toBe(false));
    expect(await Dexie.exists("talaan-user-3")).toBe(true);
    expect(getSession()).toBeNull();
  });
});

describe("the header", () => {
  it("says how many inspections need a decision, and links to the list", async () => {
    status.conflicts = 2;
    signIn();
    renderApp("/");
    expect(await screen.findByRole("link", { name: "2 need your decision" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("says nothing when there is nothing to decide", async () => {
    signIn();
    renderApp("/");
    await screen.findByRole("heading", { name: "Assignments" });
    expect(screen.queryByText(/need your decision|needs your decision/)).not.toBeInTheDocument();
  });
});
