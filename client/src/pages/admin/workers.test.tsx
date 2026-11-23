import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations, json, mockFetch, renderApp, signIn } from "../../test/utils";

// The workers page (slice 7.2): workers, invites, and the invite link shown once (ADR 0014).

const ADMIN = { id: 1, username: "admin", role: "admin", permissions: [] };
const page = (results: unknown[], count = results.length) => ({
  count,
  next: null,
  previous: null,
  results,
});
const FUTURE = "2099-01-08T10:00:00Z";

const invite = (over: object = {}) => ({
  id: 5,
  username: "maria",
  first_name: "Maria",
  last_name: "Cruz",
  status: "pending",
  created_by: "admin",
  created_at: "2026-11-20T10:00:00Z",
  expires_at: FUTURE,
  accepted_at: null,
  ...over,
});

const INVITES = [
  invite(),
  invite({ id: 4, username: "ben", first_name: "", last_name: "", status: "expired" }),
  invite({
    id: 3,
    username: "ana",
    first_name: "Ana",
    last_name: "Reyes",
    status: "accepted",
    accepted_at: "2026-11-19T09:00:00Z",
  }),
  invite({ id: 2, username: "old", first_name: "", last_name: "", status: "revoked" }),
];

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body?: Record<string, unknown>;
}

function server(handlers: Record<string, (call: Call) => Response> = {}) {
  const calls: Call[] = [];
  mockFetch(async (request) => {
    const url = new URL(request.url);
    const raw = request.method === "POST" ? await request.text() : "";
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
    const call = { method: request.method, path: url.pathname, query: url.searchParams, body };
    calls.push(call);
    const key = `${request.method} ${url.pathname}`;
    if (handlers[key]) return handlers[key](call);
    switch (key) {
      case "GET /api/admin/workers/":
        return json([
          { id: 2, username: "worker1", first_name: "Wendy", last_name: "Field" },
          { id: 6, username: "ana", first_name: "", last_name: "" },
        ]);
      case "GET /api/admin/invites/":
        return json(page(INVITES));
      default:
        return json({ code: "not_found" }, 404);
    }
  });
  const to = (method: string, path: string) =>
    calls.filter((c) => c.method === method && c.path === path);
  return { calls, to };
}

function open() {
  signIn(ADMIN);
  return renderApp("/manage/workers");
}

describe("the workers page", () => {
  it("lists workers and invites, with actions only for open invites", async () => {
    server();
    const { container } = open();
    const workers = await screen.findByRole("table", { name: "Workers" });
    const workerRows = within(workers).getAllByRole("row").slice(1);
    expect(workerRows.map((r) => r.textContent)).toEqual(["Wendy Fieldworker1", "—ana"]);

    const invites = await screen.findByRole("table", { name: "Invites" });
    const rows = within(invites).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[2]!.textContent)).toEqual([
      "Waiting",
      "Expired",
      "Joined",
      "Revoked",
    ]);
    expect(screen.getByRole("button", { name: "New link for maria" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke invite for ben" })).toBeInTheDocument();
    for (const closed of ["ana", "old"]) {
      expect(screen.queryByRole("button", { name: `New link for ${closed}` })).toBeNull();
      expect(screen.queryByRole("button", { name: `Revoke invite for ${closed}` })).toBeNull();
    }
    await expectNoA11yViolations(container);
  });

  it("says when there are no workers or invites yet", async () => {
    server({
      "GET /api/admin/workers/": () => json([]),
      "GET /api/admin/invites/": () => json(page([])),
    });
    open();
    expect(await screen.findByText("No workers yet")).toBeInTheDocument();
    expect(await screen.findByText("Invite a worker to get started.")).toBeInTheDocument();
  });

  it("filters invites by state", async () => {
    const api = server();
    open();
    await screen.findByRole("table", { name: "Invites" });
    expect(api.to("GET", "/api/admin/invites/").at(-1)!.query.get("status")).toBeNull();
    await userEvent.setup().selectOptions(screen.getByLabelText("Show"), "Expired");
    await waitFor(() =>
      expect(api.to("GET", "/api/admin/invites/").at(-1)!.query.get("status")).toBe("expired"),
    );
  });
});

describe("inviting", () => {
  it("asks for a username before calling the server", async () => {
    const api = server();
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Create invite link" }));
    expect(await screen.findByText("Enter a username.")).toBeInTheDocument();
    expect(api.to("POST", "/api/admin/invites/")).toHaveLength(0);
  });

  it("creates the invite, shows the link once and forgets it on Done", async () => {
    const api = server({
      "POST /api/admin/invites/": () => json({ ...invite(), token: "tok-123" }, 201),
    });
    open();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Username/), " maria ");
    await user.type(screen.getByLabelText("First name (optional)"), " Maria ");
    await user.type(screen.getByLabelText("Last name (optional)"), "Cruz");
    const listCalls = api.to("GET", "/api/admin/invites/").length;
    await user.click(screen.getByRole("button", { name: "Create invite link" }));

    const heading = await screen.findByRole("heading", { name: "Invite link for Maria Cruz" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(api.to("POST", "/api/admin/invites/")[0]!.body).toEqual({
      username: "maria",
      first_name: "Maria",
      last_name: "Cruz",
    });
    const link = `${window.location.origin}/invite#tok-123`;
    expect(screen.getByLabelText("Invite link")).toHaveValue(link);
    expect(screen.getByText(/not shown again/)).toBeInTheDocument();
    await waitFor(() =>
      expect(api.to("GET", "/api/admin/invites/").length).toBeGreaterThan(listCalls),
    );

    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByText("Link copied.")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(link);

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByLabelText("Invite link")).toBeNull();
    expect(document.body.innerHTML).not.toContain("tok-123");
    expect(screen.getByRole("button", { name: "Create invite link" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Username/)).toHaveValue("");
  });

  it("selects the link when the clipboard is refused", async () => {
    server({
      "POST /api/admin/invites/": () => json({ ...invite(), token: "tok-123" }, 201),
    });
    open();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Username/), "maria");
    await user.click(screen.getByRole("button", { name: "Create invite link" }));
    await screen.findByLabelText("Invite link");
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByText(/Couldn't copy/)).toBeInTheDocument();
    expect(screen.getByLabelText("Invite link")).toHaveFocus();
  });

  it("shows the server's field errors", async () => {
    server({
      "POST /api/admin/invites/": () =>
        json(
          {
            code: "validation_error",
            errors: { username: ["A user with this username already exists."] },
          },
          400,
        ),
    });
    open();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Username/), "worker1");
    await user.click(screen.getByRole("button", { name: "Create invite link" }));
    expect(
      await screen.findByText("A user with this username already exists."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Username/)).toHaveAttribute("aria-invalid", "true");
  });
});

describe("open invites", () => {
  it("makes a new link only after confirming, and shows it", async () => {
    const api = server({
      "POST /api/admin/invites/5/new-link/": () => json({ ...invite(), token: "tok-new" }),
    });
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New link for maria" }));
    expect(api.to("POST", "/api/admin/invites/5/new-link/")).toHaveLength(0);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/stops working/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Make new link" }));
    expect(await screen.findByLabelText("Invite link")).toHaveValue(
      `${window.location.origin}/invite#tok-new`,
    );
    expect(api.to("POST", "/api/admin/invites/5/new-link/")).toHaveLength(1);
  });

  it("revokes only after confirming", async () => {
    const api = server({
      "POST /api/admin/invites/4/revoke/": () => json(invite({ id: 4, status: "revoked" })),
    });
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Revoke invite for ben" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(api.to("POST", "/api/admin/invites/4/revoke/")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Revoke invite for ben" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Revoke invite" }),
    );
    expect(await screen.findByText(/Revoked the invite for ben/)).toBeInTheDocument();
    expect(api.to("POST", "/api/admin/invites/4/revoke/")).toHaveLength(1);
  });

  it("says so when the invite was closed in the meantime", async () => {
    server({
      "POST /api/admin/invites/5/revoke/": () =>
        json({ code: "invite_closed", detail: "This invite has been accepted or revoked." }, 409),
    });
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Revoke invite for maria" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Revoke invite" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The invite for maria was already used or revoked.",
    );
  });
});
