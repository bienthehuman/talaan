import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { GENERATOR_SCHEMA } from "../../test/fixtures";
import { expectNoA11yViolations, json, mockFetch, renderApp, signIn } from "../../test/utils";

const ADMIN = { id: 1, username: "admin", role: "admin", permissions: [] };
const page = (results: unknown[], count = results.length) => ({
  count,
  next: null,
  previous: null,
  results,
});

const FORMS = [
  {
    id: 1,
    name: "Generator inspection",
    created_at: "2026-11-01T00:00:00Z",
    versions: [
      {
        id: 10,
        number: 1,
        published_at: "2026-11-01T00:00:00Z",
        created_at: "2026-11-01T00:00:00Z",
      },
      {
        id: 11,
        number: 2,
        published_at: "2026-11-05T00:00:00Z",
        created_at: "2026-11-05T00:00:00Z",
      },
    ],
  },
  { id: 2, name: "Roof check", created_at: "2026-11-02T00:00:00Z", versions: [] },
  {
    id: 3,
    name: "Pump check",
    created_at: "2026-11-03T00:00:00Z",
    versions: [{ id: 20, number: 1, published_at: null, created_at: "2026-11-03T00:00:00Z" }],
  },
];

const assignment = (over: object = {}) => ({
  id: 7,
  form_version_id: 11,
  form_name: "Generator inspection",
  form_version_number: 2,
  worker: { id: 2, username: "worker1" },
  site_name: "North plant",
  due_date: "2026-12-01",
  cancelled: false,
  submissions: 3,
  created_at: "2026-11-10T00:00:00Z",
  ...over,
});

const conflict = (over: object = {}) => ({
  id: 1,
  created_at: "2026-11-18T08:00:00Z",
  kind: "conflict",
  reason: "field_conflict",
  fields: ["notes"],
  submission_id: "11111111-1111-4111-8111-111111111111",
  site_name: "North plant",
  form_name: "Generator inspection",
  worker: { id: 2, username: "worker1" },
  mutation_id: null,
  changed_since: false,
  ...over,
});

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
          { id: 2, username: "worker1" },
          { id: 3, username: "worker2" },
        ]);
      case "GET /api/admin/forms/":
        return json(page(FORMS));
      case "GET /api/admin/form-versions/11/":
        return json({
          id: 11,
          number: 2,
          published_at: "x",
          created_at: "x",
          form_id: 1,
          form_name: "Generator inspection",
          schema: GENERATOR_SCHEMA,
        });
      case "POST /api/admin/forms/check-schema/":
        return json({ valid: true, errors: [] });
      case "GET /api/admin/assignments/":
        return json(
          page([assignment(), assignment({ id: 8, site_name: "Old site", cancelled: true })]),
        );
      case "GET /api/admin/conflicts/":
        return json(page([conflict()]));
      default:
        return json({ code: "not_found" }, 404);
    }
  });
  const to = (method: string, path: string) =>
    calls.filter((c) => c.method === method && c.path === path);
  return { calls, to };
}

const signInAdmin = () => signIn(ADMIN);

describe("admin navigation", () => {
  it("links every admin screen", async () => {
    server();
    signInAdmin();
    renderApp("/manage/review");
    const nav = await screen.findByRole("navigation", { name: "Admin" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((l) => [l.textContent, l.getAttribute("href")]),
    ).toEqual([
      ["Review", "/manage/review"],
      ["Forms", "/manage/forms"],
      ["Assignments", "/manage/assignments"],
      ["Conflict log", "/manage/conflicts"],
    ]);
  });
});

describe("forms", () => {
  it("lists forms with their versions and a way to publish another", async () => {
    server();
    signInAdmin();
    const { container } = renderApp("/manage/forms");
    const section = await screen.findByRole("region", { name: "Generator inspection" });
    expect(within(section).getByText(/Version 1 · published/)).toBeInTheDocument();
    expect(within(section).getByText(/Version 2 · published/)).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: "New version" })).toHaveAttribute(
      "href",
      "/manage/forms/1/edit",
    );
    const empty = screen.getByRole("region", { name: "Roof check" });
    expect(within(empty).getByText(/No versions yet/)).toBeInTheDocument();
    expect(
      within(empty).getByRole("link", { name: "Write the first version" }),
    ).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("creates a form and opens the editor", async () => {
    const api = server({
      "POST /api/admin/forms/": () =>
        json({ id: 9, name: "Pump check", created_at: "x", versions: [] }, 201),
    });
    signInAdmin();
    const { router } = renderApp("/manage/forms");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "  Pump check ");
    await user.click(screen.getByRole("button", { name: "Create form" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/manage/forms/9/edit"));
    expect(api.to("POST", "/api/admin/forms/")[0]!.body).toEqual({ name: "Pump check" });
  });

  it("says when the name is taken", async () => {
    server({
      "POST /api/admin/forms/": () =>
        json(
          { code: "validation_error", errors: { name: ["A form with this name already exists."] } },
          400,
        ),
    });
    signInAdmin();
    renderApp("/manage/forms");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Roof check");
    await user.click(screen.getByRole("button", { name: "Create form" }));
    expect(await screen.findByText("A form with this name already exists.")).toBeInTheDocument();
  });
});

describe("the form editor", () => {
  const open = async () => {
    signInAdmin();
    const r = renderApp("/manage/forms/1/edit");
    await screen.findByRole("heading", { name: "Generator inspection · version 3" });
    return r;
  };

  it("starts from the latest version and previews the form a worker would see", async () => {
    server();
    const { container } = await open();
    const editor = screen.getByLabelText("Form schema (JSON)") as HTMLTextAreaElement;
    expect(JSON.parse(editor.value)).toEqual(GENERATOR_SCHEMA);
    const preview = screen.getByRole("region", { name: "Preview" });
    expect(within(preview).getByLabelText("Oil level (required)")).toBeInTheDocument();
    expect(within(preview).getByLabelText("Hours run (required)")).toBeInTheDocument();
    expect(await screen.findByText("The server accepts this schema.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish version 3" })).toBeEnabled();
    await expectNoA11yViolations(container);
  });

  it("the preview follows the text", async () => {
    server();
    await open();
    const editor = screen.getByLabelText("Form schema (JSON)");
    const schema = {
      ...GENERATOR_SCHEMA,
      properties: { tank: { type: "string", title: "Tank level" } },
      required: [],
    };
    await userEvent.setup().clear(editor);
    await userEvent.setup().click(editor);
    await userEvent.setup().paste(JSON.stringify(schema));
    expect(await screen.findByLabelText("Tank level")).toBeInTheDocument();
    expect(screen.queryByLabelText("Oil level (required)")).not.toBeInTheDocument();
  });

  it("will not publish text that is not JSON, and says what is wrong", async () => {
    server();
    await open();
    const editor = screen.getByLabelText("Form schema (JSON)");
    const user = userEvent.setup();
    await user.click(editor);
    await user.paste("{ not json");
    expect(await screen.findByText(/Not valid JSON:/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish version 3" })).toBeDisabled();
  });

  it("shows the server's reasons and will not publish a schema it would refuse", async () => {
    server({
      "POST /api/admin/forms/check-schema/": () =>
        json({
          valid: false,
          errors: ['"additionalProperties" must be false so unknown fields are rejected.'],
        }),
    });
    await open();
    expect(await screen.findByText("The server would refuse this schema:")).toBeInTheDocument();
    expect(
      within(document.getElementById("schema-status")!).getByText(/additionalProperties/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish version 3" })).toBeDisabled();
  });

  it("publishes after confirming, then goes back to the list", async () => {
    const api = server({
      "POST /api/admin/forms/1/versions/": () =>
        json(
          {
            id: 12,
            number: 3,
            published_at: "x",
            created_at: "x",
            form_id: 1,
            form_name: "Generator inspection",
            schema: GENERATOR_SCHEMA,
          },
          201,
        ),
    });
    const { router } = await open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Publish version 3" }));
    expect(api.to("POST", "/api/admin/forms/1/versions/")).toHaveLength(0); // asked first
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/manage/forms"));
    expect(api.to("POST", "/api/admin/forms/1/versions/")[0]!.body).toEqual({
      schema: GENERATOR_SCHEMA,
    });
    expect(
      await screen.findByText("Published Generator inspection version 3."),
    ).toBeInTheDocument();
  });

  it("shows why a publish was refused", async () => {
    server({
      "POST /api/admin/forms/1/versions/": () =>
        json(
          { code: "validation_error", errors: { schema: ["Unsupported top-level keys: x."] } },
          400,
        ),
    });
    await open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Publish version 3" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Publish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unsupported top-level keys: x.");
  });

  it("offers a starter schema for a form with no versions", async () => {
    server();
    signInAdmin();
    renderApp("/manage/forms/2/edit");
    await screen.findByRole("heading", { name: "Roof check · version 1" });
    expect(
      JSON.parse((screen.getByLabelText("Form schema (JSON)") as HTMLTextAreaElement).value).type,
    ).toBe("object");
  });
});

describe("assignments", () => {
  it("lists assignments with state, counts and a cancel only for active ones", async () => {
    server();
    signInAdmin();
    const { container } = renderApp("/manage/assignments");
    const table = await screen.findByRole("table", { name: "Assignments" });
    const rows = within(table).getAllByRole("row");
    expect(
      within(rows[1]!)
        .getAllByRole("cell")
        .map((c) => c.textContent)
        .slice(0, 6),
    ).toEqual(["North plant", "Generator inspection v2", "worker1", "2026-12-01", "3", "Active"]);
    expect(
      within(rows[1]!).getByRole("button", { name: "Cancel North plant" }),
    ).toBeInTheDocument();
    expect(within(rows[2]!).queryByRole("button")).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("offers only published versions, checks the form, then creates", async () => {
    const api = server({
      "POST /api/admin/assignments/": () => json(assignment(), 201),
    });
    signInAdmin();
    renderApp("/manage/assignments");
    const user = userEvent.setup();
    const version = await screen.findByLabelText("Form version");
    // The page loads on first visit, then fetches its lists; wait for the options, not just the select.
    await within(version).findByRole("option", { name: "Generator inspection v2" });
    expect(
      within(version)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Choose…", "Generator inspection v1", "Generator inspection v2"]);

    await user.click(screen.getByRole("button", { name: "Assign" }));
    expect(screen.getByText("Choose a form version.")).toBeInTheDocument();
    expect(screen.getByText("Choose a worker.")).toBeInTheDocument();
    expect(screen.getByText("Enter a site name.")).toBeInTheDocument();
    expect(api.to("POST", "/api/admin/assignments/")).toHaveLength(0);

    await user.selectOptions(version, "Generator inspection v2");
    await user.selectOptions(screen.getByLabelText("Worker", { selector: "#a-worker" }), "worker1");
    await user.type(screen.getByLabelText("Site"), " East yard ");
    await user.type(screen.getByLabelText("Due date (optional)"), "2026-12-24");
    await user.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(api.to("POST", "/api/admin/assignments/")).toHaveLength(1));
    expect(api.to("POST", "/api/admin/assignments/")[0]!.body).toEqual({
      form_version_id: 11,
      worker_id: 2,
      site_name: "East yard",
      due_date: "2026-12-24",
    });
    expect(
      await screen.findByText(/Assigned Generator inspection at North plant to worker1/),
    ).toBeInTheDocument();
  });

  it("shows the server's field errors", async () => {
    server({
      "POST /api/admin/assignments/": () =>
        json(
          {
            code: "validation_error",
            errors: { worker: ["Assignments go to users with the worker role."] },
          },
          400,
        ),
    });
    signInAdmin();
    renderApp("/manage/assignments");
    const user = userEvent.setup();
    const version = await screen.findByLabelText("Form version");
    await within(version).findByRole("option", { name: "Generator inspection v1" });
    await user.selectOptions(version, "Generator inspection v1");
    await user.selectOptions(screen.getByLabelText("Worker", { selector: "#a-worker" }), "worker1");
    await user.type(screen.getByLabelText("Site"), "X");
    await user.click(screen.getByRole("button", { name: "Assign" }));
    expect(
      await screen.findByText("Assignments go to users with the worker role."),
    ).toBeInTheDocument();
  });

  it("cancels only after confirming", async () => {
    const api = server({
      "POST /api/admin/assignments/7/cancel/": () => json(assignment({ cancelled: true })),
    });
    signInAdmin();
    renderApp("/manage/assignments");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancel North plant" }));
    expect(api.to("POST", "/api/admin/assignments/7/cancel/")).toHaveLength(0);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel assignment" }),
    );
    await waitFor(() => expect(api.to("POST", "/api/admin/assignments/7/cancel/")).toHaveLength(1));
    expect(await screen.findByText(/Existing inspections stay/)).toBeInTheDocument();
  });

  it("filters by state and worker", async () => {
    const api = server();
    signInAdmin();
    renderApp("/manage/assignments");
    const user = userEvent.setup();
    await screen.findByRole("table");
    expect(api.to("GET", "/api/admin/assignments/").at(-1)!.query.get("cancelled")).toBe("false");
    await user.selectOptions(screen.getByLabelText("Show"), "All");
    await waitFor(() =>
      expect(api.to("GET", "/api/admin/assignments/").at(-1)!.query.get("cancelled")).toBe("any"),
    );
    await user.selectOptions(
      screen.getByLabelText("Worker", { selector: "#af-worker" }),
      "worker2",
    );
    await waitFor(() =>
      expect(api.to("GET", "/api/admin/assignments/").at(-1)!.query.get("worker")).toBe("3"),
    );
  });
});

describe("the conflict log", () => {
  it("says what happened, to whom, and whether the worker has changed the record since", async () => {
    server({
      "GET /api/admin/conflicts/": () =>
        json(
          page([
            conflict(),
            conflict({
              id: 2,
              kind: "rejected",
              reason: "locked",
              fields: [],
              changed_since: true,
              site_name: "Harbour",
            }),
          ]),
        ),
    });
    signInAdmin();
    const { container } = renderApp("/manage/conflicts");
    const table = await screen.findByRole("table", { name: "Conflict log" });
    const [first, second] = within(table).getAllByRole("row").slice(1);
    expect(
      within(first!).getByText("Conflict: Same field changed on two devices"),
    ).toBeInTheDocument();
    expect(within(first!).getByText("notes")).toBeInTheDocument();
    expect(within(first!).getAllByRole("cell")[5]).toHaveTextContent("No");
    expect(
      within(second!).getByText("Rejected: Edited a submitted or approved record"),
    ).toBeInTheDocument();
    expect(within(second!).getAllByRole("cell")[5]).toHaveTextContent("Yes");
    expect(within(first!).getByRole("link", { name: "Open North plant record" })).toHaveAttribute(
      "href",
      "/manage/review/11111111-1111-4111-8111-111111111111",
    );
    await expectNoA11yViolations(container);
  });

  it("filters by kind, changed since and worker", async () => {
    const api = server();
    signInAdmin();
    renderApp("/manage/conflicts");
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.selectOptions(screen.getByLabelText("Kind"), "Rejections");
    await waitFor(() =>
      expect(api.to("GET", "/api/admin/conflicts/").at(-1)!.query.get("kind")).toBe("rejected"),
    );
    await user.selectOptions(
      screen.getByLabelText("Changed since"),
      "No later change from the worker",
    );
    await waitFor(() =>
      expect(api.to("GET", "/api/admin/conflicts/").at(-1)!.query.get("changed_since")).toBe(
        "false",
      ),
    );
    await user.selectOptions(screen.getByLabelText("Worker"), "worker2");
    await waitFor(() =>
      expect(api.to("GET", "/api/admin/conflicts/").at(-1)!.query.get("worker")).toBe("3"),
    );
  });

  it("says so when the log is empty, and pages", async () => {
    server({ "GET /api/admin/conflicts/": () => json(page([])) });
    signInAdmin();
    renderApp("/manage/conflicts");
    expect(await screen.findByText("Nothing logged")).toBeInTheDocument();
  });

  it("pages through a long log", async () => {
    const api = server({ "GET /api/admin/conflicts/": () => json(page([conflict()], 60)) });
    signInAdmin();
    renderApp("/manage/conflicts");
    await screen.findByText("1–1 of 60");
    await userEvent.setup().click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(api.to("GET", "/api/admin/conflicts/").at(-1)!.query.get("offset")).toBe("25"),
    );
  });
});
