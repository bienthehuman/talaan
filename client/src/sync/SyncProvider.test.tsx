import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "../auth/AuthContext";
import { json, mockFetch, signIn, WORKER } from "../test/utils";
import { SyncProvider } from "./SyncProvider";

function mount() {
  const fetch = mockFetch(() =>
    json({ records: [], next_cursor: 0, has_more: false, results: [] }),
  );
  render(
    <AuthProvider>
      <SyncProvider>
        <p>app</p>
      </SyncProvider>
    </AuthProvider>,
  );
  return fetch;
}

describe("SyncProvider", () => {
  it("starts syncing for a worker", async () => {
    signIn(WORKER);
    const fetch = mount();
    // Wait for the whole cycle (pull, assignments, form versions) so it cannot spill into the next test.
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(new URL(fetch.mock.calls[0]![0].url).pathname).toMatch(/^\/api\/sync\//);
  });

  it("does not start for an admin, who has no device to sync", async () => {
    signIn({ id: 1, username: "admin", role: "admin", permissions: [] });
    const fetch = mount();
    await new Promise((r) => setTimeout(r, 150));
    expect(fetch).not.toHaveBeenCalled();
  });
});
