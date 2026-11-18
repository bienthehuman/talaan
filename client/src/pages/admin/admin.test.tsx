import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GENERATOR_SCHEMA } from "../../test/fixtures";
import {
  expectNoA11yViolations,
  json,
  mockFetch,
  renderApp,
  signIn,
  WORKER,
} from "../../test/utils";

const ADMIN = { id: 1, username: "admin", role: "admin", permissions: [] };
const ID = "11111111-1111-4111-8111-111111111111";

const row = (over: object = {}) => ({
  id: ID,
  assignment_id: 1,
  site_name: "North plant",
  form_name: "Generator inspection",
  form_version_id: 1,
  form_version_number: 1,
  worker: { id: 2, username: "worker1" },
  status: "submitted",
  version: 2,
  deleted: false,
  server_seq: 5,
  updated_by: "worker1",
  updated_at: "2026-11-18T08:00:00Z",
  ...over,
});

const event = (id: number, kind: string, actor: string, detail = {}) => ({
  id,
  version: id,
  kind,
  actor: { id: id, username: actor },
  mutation_id: null,
  detail,
  created_at: "2026-11-18T08:00:00Z",
});

function detail(over: object = {}) {
  return {
    ...row(),
    data: { oil_level: "ok", coolant_ok: true, hours_run: 120 },
    field_versions: {},
    schema: GENERATOR_SCHEMA,
    events: [
      event(1, "created", "worker1"),
      event(2, "submitted", "worker1"),
      event(3, "returned", "admin", { reason: "Redo the oil check", from_status: "submitted" }),
    ],
    ...over,
  };
}

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body?: Record<string, unknown>;
}

/** A scripted admin API. `list` and `one` are served as given; actions answer `action`. */
function admin(
  opts: {
    list?: object;
    one?: () => object;
    action?: (body: Record<string, unknown>) => object;
    failList?: boolean;
  } = {},
) {
  const calls: Call[] = [];
  const fetch = mockFetch(async (request) => {
    const url = new URL(request.url);
    const body =
      request.method === "POST" ? ((await request.json()) as Record<string, unknown>) : undefined;
    calls.push({ method: request.method, path: url.pathname, query: url.searchParams, body });
    if (url.pathname === "/api/admin/workers/") {
      return json([
        { id: 2, username: "worker1" },
        { id: 3, username: "worker2" },
      ]);
    }
    if (url.pathname === "/api/admin/submissions/") {
      if (opts.failList) return json({ code: "server_error" }, 500);
      return json(opts.list ?? { count: 1, next: null, previous: null, results: [row()] });
    }
    if (url.pathname === `/api/admin/submissions/${ID}/`)
      return json(opts.one ? opts.one() : detail());
    if (url.pathname === `/api/admin/submissions/${ID}/actions/`) {
      return json(
        opts.action
          ? opts.action(body!)
          : { mutation_id: ID, status: "applied", record: { id: ID, version: 3 } },
      );
    }
    return json({ code: "not_found" }, 404);
  });
  const lastList = () => calls.filter((c) => c.path === "/api/admin/submissions/").at(-1)!;
  const posts = () => calls.filter((c) => c.method === "POST");
  return { fetch, calls, lastList, posts };
}

const signInAdmin = () => signIn(ADMIN);

describe("who sees what", () => {
  it("sends an admin to the review queue and shows the admin navigation", async () => {
    admin();
    signInAdmin();
    const { router } = renderApp("/");
    await screen.findByRole("heading", { name: "Review" });
    expect(router.state.location.pathname).toBe("/manage/review");
    expect(screen.getByRole("navigation", { name: "Admin" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync now" })).not.toBeInTheDocument();
    expect(screen.queryByText(/pending · Last sync/)).not.toBeInTheDocument();
  });

  it("keeps a worker out and never calls the admin API for them", async () => {
    const api = admin();
    signIn(WORKER);
    renderApp("/manage/review");
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
    expect(api.calls.filter((c) => c.path.startsWith("/api/admin"))).toEqual([]);
  });
});

describe("the review queue", () => {
  it("opens on submitted records and lists who, what and when", async () => {
    const api = admin();
    signInAdmin();
    const { container } = renderApp("/manage/review");
    const table = await screen.findByRole("table", { name: "Submissions" });
    expect(api.lastList().query.get("status")).toBe("submitted");
    expect(api.lastList().query.get("deleted")).toBe("false");
    const cells = within(within(table).getAllByRole("row")[1]!).getAllByRole("cell");
    expect(cells.map((c) => c.textContent).slice(0, 4)).toEqual([
      "North plant",
      "Generator inspection v1",
      "worker1",
      "Submitted",
    ]);
    expect(within(table).getByRole("link", { name: "Review North plant" })).toHaveAttribute(
      "href",
      `/manage/review/${ID}`,
    );
    await expectNoA11yViolations(container);
  });

  it("filters by status, worker and deleted, and each filter starts from the first page", async () => {
    const api = admin();
    signInAdmin();
    renderApp("/manage/review?offset=25");
    await screen.findByRole("table");
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("Status"), "all");
    await waitFor(() => expect(api.lastList().query.has("status")).toBe(false));
    expect(api.lastList().query.get("offset")).toBe("0");

    await user.selectOptions(await screen.findByLabelText("Worker"), "worker2");
    await waitFor(() => expect(api.lastList().query.get("worker")).toBe("3"));

    await user.selectOptions(screen.getByLabelText("Show"), "Deleted");
    await waitFor(() => expect(api.lastList().query.get("deleted")).toBe("true"));
  });

  it("pages through the results", async () => {
    const api = admin({
      list: { count: 60, next: "x", previous: null, results: [row()] },
    });
    signInAdmin();
    renderApp("/manage/review");
    await screen.findByText("1–1 of 60");
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(api.lastList().query.get("offset")).toBe("25"));
    expect(await screen.findByRole("button", { name: "Previous" })).toBeEnabled();
  });

  it("says so when nothing matches", async () => {
    admin({ list: { count: 0, next: null, previous: null, results: [] } });
    signInAdmin();
    renderApp("/manage/review");
    expect(await screen.findByText("Nothing here")).toBeInTheDocument();
  });

  it("explains a server failure and can retry", async () => {
    admin({ failList: true });
    signInAdmin();
    renderApp("/manage/review");
    expect(
      await screen.findByText("The server had a problem. Try again in a moment."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("explains when the server cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    signInAdmin();
    renderApp("/manage/review");
    expect(
      await screen.findByText("Can't reach the server. Check your connection and try again."),
    ).toBeInTheDocument();
  });
});

describe("one submission", () => {
  it("shows the answers with their titles and the history in order", async () => {
    admin();
    signInAdmin();
    const { container } = renderApp(`/manage/review/${ID}`);
    await screen.findByRole("heading", { name: "Generator inspection · North plant" });
    const answers = screen.getByRole("region", { name: "Answers" });
    expect(within(answers).getByText("Oil level")).toBeInTheDocument();
    expect(within(answers).getByText("120")).toBeInTheDocument();
    expect(within(answers).getAllByText("Not set").length).toBeGreaterThan(0);
    const history = within(screen.getByRole("region", { name: "History" })).getAllByRole(
      "listitem",
    );
    expect(history.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Created · version 1 · worker1"),
      expect.stringContaining("Submitted · version 2 · worker1"),
      expect.stringContaining("Returned · version 3 · admin"),
    ]);
    expect(history[2]).toHaveTextContent("Redo the oil check");
    await expectNoA11yViolations(container);
  });

  it.each([
    ["submitted", false, ["Approve", "Return to worker…", "Edit answers", "Delete"]],
    ["approved", false, ["Return to worker…", "Edit answers", "Delete"]],
    ["draft", false, ["Edit answers", "Delete"]],
    ["returned", false, ["Edit answers", "Delete"]],
    ["submitted", true, ["Restore"]],
  ])(
    "a %s record (deleted: %s) offers exactly the actions that can work",
    async (status, deleted, expected) => {
      admin({ one: () => detail({ status, deleted }) });
      signInAdmin();
      renderApp(`/manage/review/${ID}`);
      const group = await screen.findByRole("group", { name: "Actions" });
      expect(
        within(group)
          .getAllByRole("button")
          .map((b) => b.textContent),
      ).toEqual(expected);
    },
  );

  it("approves and reloads", async () => {
    const api = admin();
    signInAdmin();
    renderApp(`/manage/review/${ID}`);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.posts()).toHaveLength(1));
    expect(api.posts()[0]!.body).toMatchObject({ action: "approve" });
    expect(await screen.findByText("Approved.")).toBeInTheDocument();
    expect(api.calls.filter((c) => c.path === `/api/admin/submissions/${ID}/`)).toHaveLength(2);
  });

  it("shows the server's reason when an action is refused", async () => {
    admin({
      action: () => ({
        mutation_id: ID,
        status: "rejected",
        code: "invalid_state",
        detail: "Only a submitted record can be approved (this one is approved).",
      }),
    });
    signInAdmin();
    renderApp(`/manage/review/${ID}`);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only a submitted record can be approved",
    );
  });

  it("returns with a reason, and will not without one", async () => {
    const api = admin();
    signInAdmin();
    renderApp(`/manage/review/${ID}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Return to worker…" }));
    const dialog = screen.getByRole("dialog", { name: "Return to the worker" });
    await user.click(within(dialog).getByRole("button", { name: "Return" }));
    expect(within(dialog).getByText("Enter a reason.")).toBeInTheDocument();
    expect(api.posts()).toHaveLength(0);

    await user.type(within(dialog).getByLabelText(/Reason/), "  Photo missing ");
    await user.click(within(dialog).getByRole("button", { name: "Return" }));
    await waitFor(() => expect(api.posts()).toHaveLength(1));
    expect(api.posts()[0]!.body).toMatchObject({ action: "return", reason: "Photo missing" });
  });

  it("deletes only after confirming, and restores a deleted record", async () => {
    const api = admin();
    signInAdmin();
    renderApp(`/manage/review/${ID}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(api.posts()).toHaveLength(0);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.posts()[0]?.body).toMatchObject({ action: "delete" }));
  });

  it("restores a deleted record", async () => {
    const api = admin({ one: () => detail({ deleted: true }) });
    signInAdmin();
    renderApp(`/manage/review/${ID}`);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Restore" }));
    await waitFor(() => expect(api.posts()[0]?.body).toMatchObject({ action: "restore" }));
  });

  it("edits answers and sends only what changed, with a cleared field as null", async () => {
    const api = admin({
      one: () =>
        detail({ data: { oil_level: "ok", coolant_ok: true, hours_run: 120, notes: "old" } }),
    });
    signInAdmin();
    renderApp(`/manage/review/${ID}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit answers" }));
    await user.clear(screen.getByLabelText("Hours run (required)"));
    await user.type(screen.getByLabelText("Hours run (required)"), "130");
    await user.clear(screen.getByLabelText("Notes"));
    await user.click(screen.getByRole("button", { name: "Save answers" }));
    await waitFor(() => expect(api.posts()).toHaveLength(1));
    expect(api.posts()[0]!.body).toMatchObject({
      action: "edit",
      fields: { hours_run: 130, notes: null },
    });
  });

  it("will not send an edit the server would refuse", async () => {
    const api = admin();
    signInAdmin();
    renderApp(`/manage/review/${ID}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit answers" }));
    await user.clear(screen.getByLabelText("Hours run (required)")); // required on a submitted record
    await user.type(screen.getByLabelText("Oil pressure (psi)"), "999");
    await user.click(screen.getByRole("button", { name: "Save answers" }));
    expect(await screen.findByText("Required.")).toBeInTheDocument();
    expect(screen.getByText("Must be at most 200.")).toBeInTheDocument();
    expect(api.posts()).toHaveLength(0);
  });

  it("closes the editor without a request when nothing changed", async () => {
    const api = admin();
    signInAdmin();
    renderApp(`/manage/review/${ID}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit answers" }));
    await user.click(screen.getByRole("button", { name: "Save answers" }));
    expect(await screen.findByRole("button", { name: "Edit answers" })).toBeInTheDocument();
    expect(api.posts()).toHaveLength(0);
  });
});
