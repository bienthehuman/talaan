import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getSession } from "../auth/session";
import { renderApp, signIn } from "../test/utils";

// Stub the sync status so there are unsent changes .
const status = vi.hoisted(() => ({ pending: 3 }));
vi.mock("../sync/status", () => ({
  useSyncStatus: () => ({
    pending: status.pending,
    lastSyncAt: null,
    state: "idle",
    syncNow: () => {},
  }),
}));

beforeEach(() => {
  status.pending = 3;
});

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
