import { describe, expect, it } from "vitest";
import { json, mockFetch, signIn } from "../test/utils";
import { refreshSession } from "./refresh";
import { getSession } from "./session";

describe("refreshSession", () => {
  it("saves the new access token and keeps the refresh token and user", async () => {
    signIn();
    const fetch = mockFetch(() => json({ access: "new-access" }));
    expect(await refreshSession()).toBe("refreshed");
    expect(getSession()).toMatchObject({ access: "new-access", refresh: "refresh-token" });
    expect(getSession()?.user.username).toBe("worker1");
    expect((await fetch.mock.calls[0]![0].json()).refresh).toBe("refresh-token");
  });

  it("asks for a login when the refresh token is no longer accepted", async () => {
    signIn();
    mockFetch(() => json({ code: "unauthenticated" }, 401));
    expect(await refreshSession()).toBe("login-required");
    expect(getSession()?.access).toBe("access-token"); // nothing was changed
  });

  it("asks for a login when there is no session at all", async () => {
    mockFetch(() => json({ access: "x" }));
    expect(await refreshSession()).toBe("login-required");
  });

  it("is 'unreachable', not a logout, when the server cannot be reached or fails", async () => {
    signIn();
    mockFetch(() => json({ code: "server_error" }, 503));
    expect(await refreshSession()).toBe("unreachable");
    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(await refreshSession()).toBe("unreachable");
    expect(getSession()?.refresh).toBe("refresh-token");
  });

  it("shares one request between simultaneous callers", async () => {
    signIn();
    const fetch = mockFetch(() => json({ access: "new" }));
    const results = await Promise.all([refreshSession(), refreshSession(), refreshSession()]);
    expect(results).toEqual(["refreshed", "refreshed", "refreshed"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
