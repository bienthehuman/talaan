import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstallPrompt } from "../components/InstallPrompt";
import { readStorageState, useStoragePersistence } from "./storage";

function installEvent(outcome: "accepted" | "dismissed" = "accepted") {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

const fire = (event: Event) => act(() => void window.dispatchEvent(event));

function standalone(on: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches: on, addEventListener() {}, removeEventListener() {} }),
  );
}

describe("the install prompt", () => {
  afterEach(() => localStorage.clear());

  it("says nothing until the browser says installing is possible", () => {
    standalone(false);
    render(<InstallPrompt />);
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  });

  it("offers to install, and uses the browser's own prompt when asked", async () => {
    standalone(false);
    render(<InstallPrompt />);
    const event = installEvent("accepted");
    await fire(event);
    expect(event.defaultPrevented).toBe(true); // kept for our own button
    await userEvent.setup().click(await screen.findByRole("button", { name: "Install" }));
    expect(event.prompt).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Install" })).toBeNull());
  });

  it("remembers 'Not now' and does not ask again on the next visit", async () => {
    standalone(false);
    const first = render(<InstallPrompt />);
    await fire(installEvent());
    await userEvent.setup().click(await screen.findByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    first.unmount();

    render(<InstallPrompt />);
    await fire(installEvent());
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("a dismissed browser dialog counts as 'Not now'", async () => {
    standalone(false);
    render(<InstallPrompt />);
    await fire(installEvent("dismissed"));
    await userEvent.setup().click(await screen.findByRole("button", { name: "Install" }));
    await waitFor(() => expect(localStorage.getItem("talaan.installDismissed")).toBe("1"));
  });

  it("never shows when the app already runs installed", async () => {
    standalone(true);
    render(<InstallPrompt />);
    await fire(installEvent());
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("goes away once the app has been installed", async () => {
    standalone(false);
    render(<InstallPrompt />);
    await fire(installEvent());
    await screen.findByRole("button", { name: "Install" });
    await fire(new Event("appinstalled"));
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });
});

function Probe({ ready }: { ready: boolean }) {
  return <p>{useStoragePersistence(ready)}</p>;
}

function storageStub(persisted: boolean, grants: boolean) {
  const persist = vi.fn().mockResolvedValue(grants);
  vi.stubGlobal("navigator", {
    ...navigator,
    storage: { persisted: vi.fn().mockResolvedValue(persisted), persist },
  });
  return persist;
}

describe("storage persistence", () => {
  it("is not requested before the device has synced", async () => {
    const persist = storageStub(false, true);
    render(<Probe ready={false} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(persist).not.toHaveBeenCalled();
  });

  it("is requested after the first sync, and the answer is reported", async () => {
    const persist = storageStub(false, true);
    render(<Probe ready />);
    expect(await screen.findByText("protected")).toBeInTheDocument();
    expect(persist).toHaveBeenCalledOnce();
  });

  it("reports a refusal honestly", async () => {
    storageStub(false, false);
    render(<Probe ready />);
    expect(await screen.findByText("not-protected")).toBeInTheDocument();
  });

  it("does not ask again when the data is already protected", async () => {
    const persist = storageStub(true, true);
    render(<Probe ready />);
    expect(await screen.findByText("protected")).toBeInTheDocument();
    expect(persist).not.toHaveBeenCalled();
  });

  it("copes with a browser that has no storage API", async () => {
    vi.stubGlobal("navigator", { ...navigator, storage: undefined });
    expect(await readStorageState()).toBe("unsupported");
    render(<Probe ready />);
    expect(await screen.findByText("unsupported")).toBeInTheDocument();
  });
});
