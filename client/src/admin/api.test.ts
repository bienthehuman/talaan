import { describe, expect, it } from "vitest";
import { getSession } from "../auth/session";
import { ApiError, messageFor, NetworkError } from "../lib/problem";
import { json, mockFetch, signIn } from "../test/utils";
import { act, listForms } from "./api";

const ADMIN = { id: 1, username: "admin", role: "admin", permissions: [] };
const EXPIRED = { status: 401, code: "unauthenticated", detail: "Token is invalid or expired" };

function paths(fetchMock: ReturnType<typeof mockFetch>): string[] {
  return fetchMock.mock.calls.map(([request]) => new URL(request.url).pathname);
}

describe("admin requests after the access token expires", () => {
  it("refreshes once and repeats the request with the new token", async () => {
    signIn(ADMIN);
    const fetchMock = mockFetch((request) => {
      if (request.url.endsWith("/api/auth/token/refresh/")) return json({ access: "new-access" });
      if (request.headers.get("Authorization") === "Bearer new-access") {
        return json({ count: 0, next: null, previous: null, results: [] });
      }
      return json(EXPIRED, 401);
    });

    await expect(listForms()).resolves.toEqual([]);
    expect(paths(fetchMock)).toEqual([
      "/api/admin/forms/",
      "/api/auth/token/refresh/",
      "/api/admin/forms/",
    ]);
    expect(getSession()?.access).toBe("new-access");
  });

  it("repeats an action with its body after a refresh", async () => {
    signIn(ADMIN);
    const bodies: unknown[] = [];
    mockFetch(async (request) => {
      if (request.url.endsWith("/api/auth/token/refresh/")) return json({ access: "new-access" });
      bodies.push(await request.json());
      if (request.headers.get("Authorization") === "Bearer new-access") {
        return json({ status: "applied", record: null });
      }
      return json(EXPIRED, 401);
    });

    await act("rec-1", "approve");
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
  });

  it("refreshes at most once per request", async () => {
    signIn(ADMIN);
    const fetchMock = mockFetch((request) =>
      request.url.endsWith("/api/auth/token/refresh/")
        ? json({ access: "new-access" })
        : json(EXPIRED, 401),
    );

    const error = await listForms().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(paths(fetchMock).filter((p) => p.endsWith("/refresh/"))).toHaveLength(1);
  });

  it("says the session expired when the refresh token is refused", async () => {
    signIn(ADMIN);
    mockFetch((request) =>
      request.url.endsWith("/api/auth/token/refresh/")
        ? json({ status: 401, code: "unauthenticated" }, 401)
        : json(EXPIRED, 401),
    );

    const error = await listForms().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).problem.code).toBe("session_expired");
    expect(messageFor(error)).toBe("Your sign-in has expired. Sign out, then sign in again.");
    expect(getSession()?.user.username).toBe("admin");
  });

  it("reports a network problem when the refresh cannot reach the server", async () => {
    signIn(ADMIN);
    mockFetch((request) => {
      if (request.url.endsWith("/api/auth/token/refresh/")) throw new TypeError("offline");
      return json(EXPIRED, 401);
    });

    await expect(listForms()).rejects.toBeInstanceOf(NetworkError);
  });

  it("does not refresh for other errors", async () => {
    signIn(ADMIN);
    const fetchMock = mockFetch(() => json({ status: 403, code: "permission_denied" }, 403));

    await expect(listForms()).rejects.toBeInstanceOf(ApiError);
    expect(paths(fetchMock)).toEqual(["/api/admin/forms/"]);
  });
});
