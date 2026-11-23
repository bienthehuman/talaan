import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { getSession } from "../auth/session";
import { expectNoA11yViolations, json, mockFetch, renderApp, signIn } from "../test/utils";

// The invite page (slice 7.3, ADR 0014): the token comes from the fragment, is sent only in POST
// bodies, and leaves the address bar as soon as the page has read it.

const TOKEN = "tok_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const INFO = {
  username: "maria",
  first_name: "Maria",
  last_name: "Cruz",
  expires_at: "2099-01-08T10:00:00Z",
};
const ME = { id: 9, username: "maria", role: "worker", permissions: [] };

interface Call {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}

function server(handlers: Record<string, () => Response> = {}) {
  const calls: Call[] = [];
  mockFetch(async (request) => {
    const url = new URL(request.url);
    const raw = request.method === "POST" ? await request.text() : "";
    calls.push({
      method: request.method,
      url: request.url,
      body: raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined,
    });
    const handler = handlers[url.pathname];
    if (handler) return handler();
    switch (url.pathname) {
      case "/api/invites/check/":
        return json(INFO);
      case "/api/invites/accept/":
        return json({ username: "maria" }, 201);
      case "/api/auth/token/":
        return json({ access: "a-token", refresh: "r-token" });
      case "/api/me/":
        return json(ME);
      default:
        return json({ code: "not_found" }, 404);
    }
  });
  const to = (path: string) => calls.filter((c) => new URL(c.url).pathname === path);
  return { calls, to };
}

const problem = (code: string, status: number) => () => json({ code, detail: "x" }, status);

async function fillPasswords(first: string, second = first) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("New password", { exact: true }), first);
  await user.type(screen.getByLabelText("Repeat the password", { exact: true }), second);
  await user.click(screen.getByRole("button", { name: "Set password and sign in" }));
}

describe("the invite page", () => {
  it("greets the invitee and removes the token from the address", async () => {
    const api = server();
    const { container, router } = renderApp(`/invite#${TOKEN}`);
    expect(await screen.findByRole("heading", { name: "Welcome, Maria" })).toBeInTheDocument();
    expect(screen.getByText("maria", { selector: "strong" })).toBeInTheDocument();
    expect(api.to("/api/invites/check/")[0]!.body).toEqual({ token: TOKEN });
    await waitFor(() => expect(router.state.location.hash).toBe(""));
    expect(router.state.location.pathname).toBe("/invite");
    for (const call of api.calls) expect(call.url).not.toContain(TOKEN);
    await expectNoA11yViolations(container);
  });

  it("sets the password, signs in and opens the app", async () => {
    const api = server();
    const { router } = renderApp(`/invite#${TOKEN}`);
    await fillPasswords("lantern-orchard-42");
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(api.to("/api/invites/accept/")[0]!.body).toEqual({
      token: TOKEN,
      password: "lantern-orchard-42",
    });
    expect(api.to("/api/auth/token/")[0]!.body).toEqual({
      username: "maria",
      password: "lantern-orchard-42",
    });
    expect(getSession()?.user.username).toBe("maria");
  });

  it("checks the two passwords match before calling the server", async () => {
    const api = server();
    renderApp(`/invite#${TOKEN}`);
    await fillPasswords("lantern-orchard-42", "lantern-orchard-43");
    expect(await screen.findByText("The two passwords are not the same.")).toBeInTheDocument();
    await userEvent.setup().clear(screen.getByLabelText("Repeat the password", { exact: true }));
    expect(api.to("/api/invites/accept/")).toHaveLength(0);
  });

  it("shows the server's password rules", async () => {
    server({
      "/api/invites/accept/": () =>
        json(
          {
            code: "validation_error",
            errors: { password: ["This password is too common.", "It is entirely numeric."] },
          },
          400,
        ),
    });
    renderApp(`/invite#${TOKEN}`);
    await fillPasswords("12345678");
    expect(
      await screen.findByText("This password is too common. It is entirely numeric."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("New password", { exact: true })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("says so when the username was taken in the meantime", async () => {
    server({ "/api/invites/accept/": problem("username_taken", 409) });
    renderApp(`/invite#${TOKEN}`);
    await fillPasswords("lantern-orchard-42");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Someone already uses the username maria",
    );
  });

  it.each([
    ["invite_expired", 410, /has expired/],
    ["invite_revoked", 410, /was withdrawn/],
    ["invite_not_found", 404, /isn't valid/],
  ])("explains a %s link", async (code, status, text) => {
    server({ "/api/invites/check/": problem(code, status) });
    renderApp(`/invite#${TOKEN}`);
    expect(await screen.findByRole("heading", { name: "This link can't be used" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(text);
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });

  it("offers sign-in for a link that was already used", async () => {
    server({ "/api/invites/check/": problem("invite_used", 410) });
    renderApp(`/invite#${TOKEN}`);
    expect(await screen.findByRole("alert")).toHaveTextContent(/already been used/);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  it("explains a link that expires while the page is open", async () => {
    server({ "/api/invites/accept/": problem("invite_expired", 410) });
    renderApp(`/invite#${TOKEN}`);
    await fillPasswords("lantern-orchard-42");
    expect(await screen.findByRole("alert")).toHaveTextContent(/has expired/);
  });

  it("does not call the server for a link without a token", async () => {
    const api = server();
    renderApp("/invite");
    expect(await screen.findByRole("alert")).toHaveTextContent(/isn't valid/);
    expect(api.calls).toHaveLength(0);
  });

  it("offers a retry when the server can't be reached", async () => {
    let fail = true;
    mockFetch(async (request) => {
      if (fail) throw new TypeError("Failed to fetch");
      return new URL(request.url).pathname === "/api/invites/check/" ? json(INFO) : json({}, 404);
    });
    renderApp(`/invite#${TOKEN}`);
    expect(await screen.findByText(/Can't connect/)).toBeInTheDocument();
    fail = false;
    await userEvent.setup().click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("heading", { name: "Welcome, Maria" })).toBeInTheDocument();
  });

  it("does not use the link while someone is signed in, and keeps it for later", async () => {
    const api = server();
    signIn();
    const { router } = renderApp(`/invite#${TOKEN}`);
    expect(
      await screen.findByRole("heading", { name: "You're already signed in" }),
    ).toBeInTheDocument();
    expect(screen.getByText("worker1", { selector: "strong" })).toBeInTheDocument();
    expect(router.state.location.hash).toBe(`#${TOKEN}`);
    expect(api.to("/api/invites/check/")).toHaveLength(0);
  });
});
