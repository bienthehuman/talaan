import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./ConfirmDialog";
import { SyncBadge, type SyncState } from "./SyncBadge";
import { TextField } from "./TextField";
import { ToastProvider, useToast } from "./Toast";

describe("SyncBadge", () => {
  const states: SyncState[] = ["pending", "syncing", "synced", "conflict", "rejected"];

  it("never shows 'Saved on this device' and 'Synced' alike", () => {
    const { container: pending } = render(<SyncBadge state="pending" />);
    const { container: synced } = render(<SyncBadge state="synced" />);
    expect(pending).toHaveTextContent("Saved on this device");
    expect(synced).toHaveTextContent("Synced");
    expect(pending.innerHTML).not.toBe(synced.innerHTML);
    // Different words and a different icon (the colour comes from a CSS Module class, not checked here).
    const icon = (c: HTMLElement) => c.querySelector("svg path")?.getAttribute("d");
    expect(icon(pending)).toBeTruthy();
    expect(icon(pending)).not.toBe(icon(synced));
  });

  it("gives every state a text label and a hidden icon, so colour is never the only signal", () => {
    for (const state of states) {
      const { container, unmount } = render(<SyncBadge state={state} />);
      expect(container.textContent?.trim().length).toBeGreaterThan(0);
      expect(container.querySelector("svg[aria-hidden='true']")).not.toBeNull();
      unmount();
    }
  });

  it("includes the reason for a rejection", () => {
    render(<SyncBadge state="rejected" reason="record is approved" />);
    expect(screen.getByText("Not accepted: record is approved")).toBeInTheDocument();
  });
});

describe("TextField", () => {
  it("links label, hint and error to the input", () => {
    render(<TextField label="Oil level" hint="Read the dipstick." error="Pick a level." />);
    const input = screen.getByLabelText("Oil level");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Read the dipstick. Pick a level.");
  });
});

describe("ConfirmDialog", () => {
  it("opens when asked and reports confirm and cancel", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        open={false}
        title="Delete?"
        message="Gone."
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <ConfirmDialog
        open
        title="Delete?"
        message="Gone."
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe("Toast", () => {
  function Trigger({ kind }: { kind?: "success" | "error" }) {
    const toast = useToast();
    return <button onClick={() => toast.show("Saved", kind)}>show</button>;
  }

  it("clears a normal toast by itself but keeps an error until dismissed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(
        <ToastProvider>
          <Trigger />
          <Trigger kind="error" />
        </ToastProvider>,
      );
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const [normal, error] = screen.getAllByRole("button", { name: "show" }) as [
        HTMLElement,
        HTMLElement,
      ];

      await user.click(normal);
      expect(screen.getAllByText("Saved")).toHaveLength(1);
      act(() => vi.advanceTimersByTime(5100));
      expect(screen.queryByText("Saved")).not.toBeInTheDocument();

      await user.click(error);
      act(() => vi.advanceTimersByTime(60000));
      expect(screen.getByText("Saved")).toBeInTheDocument();
      // An error interrupts; other toasts are polite.
      expect(screen.getByRole("alert")).toHaveTextContent("Saved");
      await user.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
