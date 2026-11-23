import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { GENERATOR_SCHEMA } from "../../test/fixtures";
import { expectNoA11yViolations, json, mockFetch, renderApp, signIn } from "../../test/utils";

// The form builder screen (slice 6.4) against a fake server that keeps one draft per form with a
// revision, like the real one: a save over a stale revision is a 409 with the draft as it is now.

const ADMIN = { id: 1, username: "admin", role: "admin", permissions: [] };
const page = (results: unknown[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});
const at = "2026-11-01T00:00:00Z";

const V1 = {
  type: "object",
  title: "Generator inspection",
  properties: { site_contact: { type: "string", title: "Site contact", maxLength: 120 } },
  required: [],
  additionalProperties: false,
};

const FORMS = [
  {
    id: 1,
    name: "Generator inspection",
    created_at: at,
    versions: [
      { id: 10, number: 1, published_at: at, created_at: at },
      { id: 11, number: 2, published_at: at, created_at: at },
    ],
  },
  { id: 2, name: "Roof check", created_at: at, versions: [] },
];

interface Draft {
  schema: unknown;
  revision: number;
  based_on_version: number | null;
  updated_by: string | null;
  updated_at: string;
}

interface Call {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

type Handler = (call: Call, state: { drafts: Map<number, Draft> }) => Response | undefined;

function server(options: { drafts?: Record<number, Draft>; handle?: Handler } = {}) {
  const calls: Call[] = [];
  const drafts = new Map(Object.entries(options.drafts ?? {}).map(([k, v]) => [Number(k), v]));
  mockFetch(async (request) => {
    const url = new URL(request.url);
    const raw = request.method === "GET" ? "" : await request.text();
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
    const call = { method: request.method, path: url.pathname, body };
    calls.push(call);
    const custom = options.handle?.(call, { drafts });
    if (custom) return custom;

    const draftPath = url.pathname.match(/^\/api\/admin\/forms\/(\d+)\/draft\/(publish\/)?$/);
    if (draftPath) {
      const formId = Number(draftPath[1]);
      const current = drafts.get(formId) ?? null;
      const stale = () =>
        json({ status: 409, code: "stale_draft", detail: "x", draft: current }, 409);
      if (request.method === "GET")
        return current ? json(current) : json({ code: "not_found" }, 404);
      if (draftPath[2]) {
        if (!current || current.revision !== body!.revision) return stale();
        drafts.delete(formId);
        return json({ id: 99, number: 3, form_id: formId, schema: current.schema }, 201);
      }
      const revision = body!.revision as number;
      if ((revision === 0 && current) || (revision > 0 && current?.revision !== revision)) {
        return stale();
      }
      const saved = {
        schema: body!.schema,
        revision: revision + 1,
        based_on_version: 2,
        updated_by: "admin",
        updated_at: at,
      };
      drafts.set(formId, saved);
      return json(saved, revision === 0 ? 201 : 200);
    }

    switch (`${request.method} ${url.pathname}`) {
      case "GET /api/admin/forms/":
        return json(page(FORMS));
      case "POST /api/admin/forms/":
        return json({ id: 5, name: body!.name, created_at: at, versions: [] }, 201);
      case "GET /api/admin/form-versions/10/":
        return json({ id: 10, number: 1, form_id: 1, schema: V1 });
      case "GET /api/admin/form-versions/11/":
        return json({ id: 11, number: 2, form_id: 1, schema: GENERATOR_SCHEMA });
      case "POST /api/admin/forms/check-schema/":
        return json({ valid: true, errors: [], changes: [] });
      default:
        return json({ code: "not_found" }, 404);
    }
  });
  const to = (method: string, path: string) =>
    calls.filter((c) => c.method === method && c.path === path);
  return { calls, to, drafts };
}

async function open(formId = 1, heading = "Generator inspection · version 3") {
  signIn(ADMIN);
  const r = renderApp(`/manage/forms/${formId}/edit`);
  await screen.findByRole("heading", { name: heading, level: 1 });
  return r;
}

const cardTitles = () =>
  screen
    .getAllByRole("heading", { level: 3 })
    .map((h) => h.textContent)
    .filter((t) => /^\d+\./.test(t ?? ""));
const card = (label: string) =>
  screen.getByRole("region", { name: new RegExp(`^\\d+\\. ${label}$`) });
const publishButton = () => screen.getByRole("button", { name: /^Publish version/ });

describe("the form builder", () => {
  it("opens the latest version as cards in order, with published IDs locked", async () => {
    const api = server();
    const { container } = await open();
    expect(screen.getByRole("tab", { name: "Builder" })).toHaveAttribute("aria-selected", "true");
    expect(cardTitles()).toEqual([
      "1. Site contact",
      "2. Oil level",
      "3. Oil pressure (psi)",
      "4. Coolant level is correct",
      "5. Hours run",
      "6. Notes",
    ]);
    const oil = card("Oil level");
    expect(within(oil).getByLabelText("Type")).toHaveValue("choice");
    expect(within(oil).getByLabelText("Field ID")).toHaveAttribute("readonly");
    const preview = screen.getByRole("region", { name: "Preview" });
    expect(within(preview).getByLabelText("Oil level (required)")).toBeInTheDocument();
    // Nothing changed yet: nothing to publish and nothing saved.
    expect(await screen.findByText("Make a change to publish version 3.")).toBeInTheDocument();
    expect(publishButton()).toBeDisabled();
    expect(api.to("PUT", "/api/admin/forms/1/draft/")).toHaveLength(0);
    await expectNoA11yViolations(container);
  });

  it("a published field keeps its kind of answer", async () => {
    server();
    await open();
    const options = (label: string) =>
      within(within(card(label)).getByLabelText("Type"))
        .getAllByRole("option")
        .map((o) => o.textContent);
    expect(options("Oil level")).toEqual(["Short text", "Long text", "Choice"]);
    expect(options("Hours run")).toEqual(["Whole number"]);
    expect(options("Coolant level is correct")).toEqual(["Yes / No"]);
  });

  it("builds every kind of field without JSON, saves a draft as it goes, and publishes it", async () => {
    const api = server();
    const { router } = await open(2, "Roof check · version 1");
    const user = userEvent.setup();
    expect(screen.getByText("No fields yet. Add the first one below.")).toBeInTheDocument();

    const labels = {
      "Short text": "Roof type",
      "Long text": "What did you see",
      Choice: "Condition",
      "Yes / No": "Gutters clear",
      "Whole number": "Loose tiles",
      Number: "Slope (degrees)",
    };
    for (const [kind, label] of Object.entries(labels)) {
      await user.click(
        within(screen.getByRole("region", { name: "Add a field" })).getByRole("button", {
          name: kind,
        }),
      );
      // The new card's label has focus, so typing goes straight in.
      await user.keyboard(label);
    }
    expect(cardTitles()).toEqual(Object.values(labels).map((l, i) => `${i + 1}. ${l}`));

    const condition = card("Condition");
    await user.clear(within(condition).getByLabelText("Choice 1"));
    await user.type(within(condition).getByLabelText("Choice 1"), "Good");
    await user.clear(within(condition).getByLabelText("Choice 2"));
    await user.type(within(condition).getByLabelText("Choice 2"), "Poor");
    await user.click(within(card("Gutters clear")).getByLabelText(/^Required/));
    await user.type(within(card("Loose tiles")).getByLabelText("Largest value (optional)"), "500");

    expect(await screen.findByText("This form is ready to publish.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Draft saved.")).toBeInTheDocument(), {
      timeout: 5000,
    });
    const saves = api.to("PUT", "/api/admin/forms/2/draft/");
    expect(saves[0]!.body!.revision).toBe(0);
    saves.slice(1).forEach((s, i) => expect(s.body!.revision).toBe(i + 1));

    await user.click(publishButton());
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/manage/forms"));
    const published = api.to("POST", "/api/admin/forms/2/draft/publish/");
    expect(published[0]!.body).toEqual({ revision: saves.length });
    const schema = saves.at(-1)!.body!.schema as Record<string, unknown>;
    expect(schema["x-order"]).toEqual([
      "roof_type",
      "what_did_you_see",
      "condition",
      "gutters_clear",
      "loose_tiles",
      "slope_degrees",
    ]);
    expect(schema.required).toEqual(["gutters_clear"]);
    expect(schema.properties).toMatchObject({
      roof_type: { type: "string", maxLength: 200 },
      what_did_you_see: { type: "string", maxLength: 2000 },
      condition: { type: "string", enum: ["Good", "Poor"] },
      gutters_clear: { type: "boolean" },
      loose_tiles: { type: "integer", maximum: 500 },
      slope_degrees: { type: "number" },
    });
    expect(await screen.findByText("Published Roof check version 3.")).toBeInTheDocument();
  }, 15_000); // types a lot and waits for autosave (1.5 s quiet)

  it("shows problems on the card they belong to and will not publish", async () => {
    server();
    const { container } = await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Short text" }));
    const untitled = card("Untitled field");
    expect(within(untitled).getByRole("list", { name: /Problems with/ })).toHaveTextContent(
      "Give this field a label.",
    );
    expect(document.getElementById("schema-status")).toHaveTextContent(
      "One field has problems, marked on the card.",
    );
    expect(publishButton()).toBeDisabled();
    await expectNoA11yViolations(container); // the untitled field in the preview too

    // Two numbers that leave no room for an answer.
    const hours = card("Hours run");
    await user.type(within(hours).getByLabelText("Largest value (optional)"), "-1");
    expect(
      within(card("Hours run")).getByText(/smallest value is larger than the largest/),
    ).toBeInTheDocument();
  });

  it("reorders fields by keyboard, keeps focus on the button and says where the field went", async () => {
    server();
    await open();
    const user = userEvent.setup();
    const down = within(card("Site contact")).getByRole("button", {
      name: "Move down Site contact",
    });
    down.focus();
    await user.keyboard("{Enter}");
    expect(cardTitles().slice(0, 2)).toEqual(["1. Oil level", "2. Site contact"]);
    expect(document.activeElement).toBe(down);
    expect(screen.getByText("Site contact moved to position 2 of 6.")).toBeInTheDocument();

    // At the top the button does nothing but keeps focus.
    const up = within(card("Oil level")).getByRole("button", { name: "Move up Oil level" });
    expect(up).toHaveAttribute("aria-disabled", "true");
    up.focus();
    await user.keyboard("{Enter}");
    expect(cardTitles()[0]).toBe("1. Oil level");
    expect(document.activeElement).toBe(up);

    expect(await screen.findByText("This form is ready to publish.")).toBeInTheDocument();
    expect(publishButton()).toBeEnabled();
  });

  it("edits choices: rename, add, move and remove, with focus following the choice", async () => {
    server();
    await open();
    const user = userEvent.setup();
    const oil = () => card("Oil level");
    await user.click(within(oil()).getByRole("button", { name: "Add a choice" }));
    expect(document.activeElement).toBe(within(oil()).getByLabelText("Choice 4"));
    await user.keyboard("overfull");
    const up = within(oil()).getByRole("button", { name: "Up overfull" });
    await user.click(up);
    expect(document.activeElement).toBe(within(oil()).getByRole("button", { name: "Up overfull" }));
    await user.click(within(oil()).getByRole("button", { name: "Remove low" }));
    const values = within(oil())
      .getAllByRole("textbox", { name: /^Choice \d/ })
      .map((i) => (i as HTMLInputElement).value);
    expect(values).toEqual(["ok", "overfull", "empty"]);
  });

  it("duplicates a field with a new ID, and removes one only after asking", async () => {
    server();
    await open();
    const user = userEvent.setup();
    await user.click(within(card("Notes")).getByRole("button", { name: "Duplicate Notes" }));
    expect(cardTitles().at(-1)).toBe("7. Notes (copy)");
    expect(within(card("Notes \\(copy\\)")).getByLabelText("Field ID")).toHaveValue("notes_copy");

    await user.click(within(card("Notes")).getByRole("button", { name: "Remove Notes" }));
    const dialog = screen.getByRole("dialog", { name: "Remove Notes?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(cardTitles()).toHaveLength(7);
    await user.click(within(card("Notes")).getByRole("button", { name: "Remove Notes" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Remove Notes?" })).getByRole("button", {
        name: "Remove",
      }),
    );
    expect(cardTitles()).toHaveLength(6);
    expect(screen.getByText("Notes removed.")).toBeInTheDocument();
  });

  it("shows what publishing changes, compared with the last published version", async () => {
    server({
      handle: (call) =>
        call.path === "/api/admin/forms/check-schema/"
          ? json({
              valid: true,
              errors: [],
              changes: [
                { level: "review", field: "notes", message: "Notes must now be filled in." },
                { level: "safe", field: "", message: "Fields are in a different order." },
              ],
            })
          : undefined,
    });
    await open();
    const summary = await screen.findByRole("heading", { name: "Changes from version 2" });
    const list = within(summary.parentElement!);
    expect(list.getByText("Notes must now be filled in.")).toBeInTheDocument();
    expect(list.getByText("Check")).toBeInTheDocument();
    expect(list.getByText("Safe")).toBeInTheDocument();
  });

  it("asks the server about the form it would publish", async () => {
    const api = server();
    await open();
    await userEvent.setup().click(within(card("Notes")).getByLabelText(/^Required/));
    await waitFor(() => {
      const last = api.to("POST", "/api/admin/forms/check-schema/").at(-1)!.body!;
      expect(last.form_id).toBe(1);
      expect((last.schema as { required: string[] }).required).toContain("notes");
    });
  });

  it("continues a saved draft and says whose it is", async () => {
    const schema = { ...GENERATOR_SCHEMA, title: "Generator inspection (draft)" };
    server({
      drafts: {
        1: { schema, revision: 4, based_on_version: 1, updated_by: "maria", updated_at: at },
      },
    });
    await open();
    expect(screen.getByText(/Continuing the draft maria saved/)).toHaveTextContent(
      "It was started from version 1; version 2 has been published since",
    );
    expect(screen.getByLabelText("Form title")).toHaveValue("Generator inspection (draft)");
    // A draft exists, so it can be published as it is.
    expect(await screen.findByText("This form is ready to publish.")).toBeInTheDocument();
  });

  it("stops saving when someone else saved first, and lets the admin choose", async () => {
    const theirs = { ...GENERATOR_SCHEMA, title: "Their title" };
    const api = server({
      handle: (call, { drafts }) => {
        if (call.method === "PUT" && !drafts.has(1)) {
          // Someone else started the draft a moment earlier.
          drafts.set(1, {
            schema: theirs,
            revision: 3,
            based_on_version: 2,
            updated_by: "maria",
            updated_at: at,
          });
        }
        return undefined;
      },
    });
    await open();
    const user = userEvent.setup();
    const title = screen.getByLabelText("Form title");
    await user.clear(title);
    await user.type(title, "Mine");
    const alert = await screen.findByRole("alert", {}, { timeout: 5000 });
    expect(alert).toHaveTextContent("maria saved this draft");
    expect(alert).toHaveTextContent("Nothing has been overwritten.");
    expect(publishButton()).toBeDisabled();

    await user.click(within(alert).getByRole("button", { name: "Keep mine (replace theirs)" }));
    await waitFor(() => expect(screen.getByText("Draft saved.")).toBeInTheDocument());
    const last = api.to("PUT", "/api/admin/forms/1/draft/").at(-1)!.body!;
    expect(last.revision).toBe(3);
    expect((last.schema as { title: string }).title).toBe("Mine");
    expect(api.drafts.get(1)!.revision).toBe(4);
  }, 15_000); // types a lot and waits for autosave (1.5 s quiet)

  it("loads the other admin's version when asked", async () => {
    const theirs = { ...GENERATOR_SCHEMA, title: "Their title" };
    const api = server({
      handle: (call, { drafts }) => {
        if (call.method === "PUT" && !drafts.has(1)) {
          drafts.set(1, {
            schema: theirs,
            revision: 3,
            based_on_version: 2,
            updated_by: "maria",
            updated_at: at,
          });
        }
        return undefined;
      },
    });
    await open();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Form title"), " changed");
    const alert = await screen.findByRole("alert", {}, { timeout: 5000 });
    const puts = api.to("PUT", "/api/admin/forms/1/draft/").length;
    await user.click(within(alert).getByRole("button", { name: "Load their version" }));
    expect(screen.getByLabelText("Form title")).toHaveValue("Their title");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Loading theirs does not save anything back.
    await act(() => new Promise((r) => setTimeout(r, 1800)));
    expect(api.to("PUT", "/api/admin/forms/1/draft/")).toHaveLength(puts);
  }, 15_000); // types a lot and waits for autosave (1.5 s quiet)

  it("says so when the form was published by someone else", async () => {
    server({
      drafts: {
        1: {
          schema: GENERATOR_SCHEMA,
          revision: 2,
          based_on_version: 2,
          updated_by: "maria",
          updated_at: at,
        },
      },
      handle: (call, { drafts }) => {
        if (call.path.endsWith("/draft/publish/")) drafts.delete(1);
        return undefined;
      },
    });
    await open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Publish version 3" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Publish" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Someone published this form while you were editing");
    expect(within(alert).getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("shows why a publish was refused", async () => {
    server({
      drafts: {
        1: {
          schema: GENERATOR_SCHEMA,
          revision: 2,
          based_on_version: 2,
          updated_by: "admin",
          updated_at: at,
        },
      },
      handle: (call) =>
        call.path.endsWith("/draft/publish/")
          ? json(
              {
                code: "validation_error",
                errors: { schema: ['"hours_run" was a integer in an earlier version.'] },
              },
              400,
            )
          : undefined,
    });
    await open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Publish version 3" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Publish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "was a integer in an earlier version",
    );
  });
});

describe("the JSON tab", () => {
  const jsonTab = () => screen.getByRole("tab", { name: "JSON (advanced)" });

  it("shows the same form as JSON and brings edits back to the builder", async () => {
    server();
    await open();
    const user = userEvent.setup();
    await user.click(jsonTab());
    const editor = screen.getByLabelText("Form schema (JSON)") as HTMLTextAreaElement;
    const schema = JSON.parse(editor.value) as Record<string, unknown>;
    expect(schema["x-order"]).toEqual(Object.keys(GENERATOR_SCHEMA.properties));
    schema.title = "Edited as JSON";
    await user.clear(editor);
    await user.click(editor);
    await user.paste(JSON.stringify(schema));
    await user.click(screen.getByRole("tab", { name: "Builder" }));
    expect(screen.getByLabelText("Form title")).toHaveValue("Edited as JSON");
  });

  it("moves between tabs with the arrow keys", async () => {
    server();
    await open();
    screen.getByRole("tab", { name: "Builder" }).focus();
    await userEvent.setup().keyboard("{ArrowRight}");
    expect(jsonTab()).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(jsonTab());
    expect(screen.getByRole("tabpanel")).toContainElement(
      screen.getByLabelText("Form schema (JSON)"),
    );
  });

  it("will not publish text that is not JSON, and stays on the JSON tab", async () => {
    server();
    await open();
    const user = userEvent.setup();
    await user.click(jsonTab());
    const editor = screen.getByLabelText("Form schema (JSON)");
    await user.click(editor);
    await user.paste("{ not json");
    expect(screen.getByText(/The text isn't valid JSON:/)).toBeInTheDocument();
    expect(publishButton()).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "Builder" }));
    expect(jsonTab()).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/The builder can't show this form/)).toBeInTheDocument();
  });

  it("keeps a form the builder cannot show in the JSON tab, with the reason", async () => {
    server({
      drafts: {
        1: {
          schema: { ...GENERATOR_SCHEMA, $defs: {} },
          revision: 1,
          based_on_version: 2,
          updated_by: "admin",
          updated_at: at,
        },
      },
      handle: (call) =>
        call.path === "/api/admin/forms/check-schema/"
          ? json({ valid: false, errors: ["Unsupported top-level keys: $defs."], changes: [] })
          : undefined,
    });
    await open();
    expect(jsonTab()).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/The builder does not know: \$defs/)).toBeInTheDocument();
    expect(
      await within(document.getElementById("schema-status")!).findByText(/Unsupported top-level/),
    ).toBeInTheDocument();
    expect(publishButton()).toBeDisabled();
  });
});

describe("a new form", () => {
  it("starts blank in the builder", async () => {
    server();
    const { container } = await open(2, "Roof check · version 1");
    expect(screen.getByLabelText("Form title")).toHaveValue("Roof check");
    expect(document.getElementById("schema-status")).toHaveTextContent("Add at least one field.");
    expect(publishButton()).toBeDisabled();
    await expectNoA11yViolations(container);
  });

  it("can start from a copy of another form's latest version, as a draft", async () => {
    const api = server();
    signIn(ADMIN);
    const { router } = renderApp("/manage/forms");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Generator (north)");
    await user.selectOptions(
      screen.getByLabelText("Start from"),
      "A copy of Generator inspection (version 2)",
    );
    await user.click(screen.getByRole("button", { name: "Create form" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/manage/forms/5/edit"));
    const put = api.to("PUT", "/api/admin/forms/5/draft/")[0]!.body!;
    expect(put.revision).toBe(0);
    expect(put.schema).toEqual({ ...GENERATOR_SCHEMA, title: "Generator (north)" });
  });
});
