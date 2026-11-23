import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, createSubmission, dbFor, getSubmission } from "../db";
import { seedReference } from "../test/fixtures";
import { expectNoA11yViolations, renderApp, signIn } from "../test/utils";

afterEach(() => closeAll());

const db = () => dbFor(2); // the signed-in test worker has id 2

async function newRecord(data = {}) {
  await seedReference();
  return createSubmission(db(), { assignmentId: 1, formVersionId: 1, data });
}

async function outboxOps() {
  return (await db().outbox.orderBy("seq").toArray()).map((e) => [e.op, e.fields] as const);
}

describe("assignments", () => {
  it("shows the empty state before anything has synced", async () => {
    signIn();
    renderApp("/");
    expect(await screen.findByText("No assignments yet")).toBeInTheDocument();
  });

  it("lists assignments and their inspections from the device, with sync state", async () => {
    await newRecord({ oil_level: "ok" });
    signIn();
    const { container } = renderApp("/");
    const section = await screen.findByRole("region", { name: "North plant" });
    expect(within(section).getByText(/Generator inspection/)).toBeInTheDocument();
    expect(within(section).getByText("Saved on this device")).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: /Draft inspection/ })).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("starts an inspection offline and opens it", async () => {
    await seedReference();
    signIn();
    const { router } = renderApp("/");
    await userEvent.setup().click(await screen.findByRole("button", { name: "New inspection" }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/submissions\//));
    expect(
      await screen.findByRole("heading", { name: "Generator inspection" }),
    ).toBeInTheDocument();
    expect(await db().outbox.count()).toBe(1);
  });

  it("does not list an inspection that was deleted", async () => {
    const row = await newRecord();
    await db().submissions.update(row.id, { deleted: true });
    signIn();
    renderApp("/");
    const section = await screen.findByRole("region", { name: "North plant" });
    expect(within(section).queryByRole("link")).not.toBeInTheDocument();
  });

  it("keeps the newest five in view and folds older ones away, except any needing the worker", async () => {
    await seedReference();
    const start = Date.now();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const row = await createSubmission(db(), { assignmentId: 1, formVersionId: 1, data: {} });
      ids.push(row.id);
      // Oldest first; the very oldest is in conflict, so it must stay visible.
      await db().submissions.update(row.id, {
        updatedAt: start + i * 1000,
        syncState: i === 0 ? "conflict" : "synced",
      });
    }
    signIn();
    const { container } = renderApp("/");
    const section = await screen.findByRole("region", { name: "North plant" });
    const more = within(section).getByText("Show 2 older inspections");
    const details = more.closest("details")!;
    expect(details).not.toHaveAttribute("open");
    const visibleLinks = within(section)
      .getAllByRole("link")
      .filter((a) => !details.contains(a));
    expect(visibleLinks).toHaveLength(6); // newest five plus the conflict
    expect(within(section).getByText("Needs your decision")).toBeInTheDocument();
    expect(within(details).getAllByRole("link", { hidden: true })).toHaveLength(2);
    // The action comes before the history.
    const button = within(section).getByRole("button", { name: "New inspection" });
    expect(button.compareDocumentPosition(visibleLinks[0]!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await expectNoA11yViolations(container);
  });

  it("does not offer a new inspection on a cancelled assignment", async () => {
    await seedReference();
    await db().assignments.update(1, { cancelled: true });
    signIn();
    renderApp("/");
    await screen.findByRole("region", { name: "North plant" });
    expect(screen.queryByRole("button", { name: "New inspection" })).not.toBeInTheDocument();
  });
});

describe("the form", () => {
  it("has a labelled control for every field and no structural a11y problems", async () => {
    const row = await newRecord();
    signIn();
    const { container } = renderApp(`/submissions/${row.id}`);
    for (const label of [
      "Site contact",
      "Oil level (required)",
      "Oil pressure (psi)",
      "Hours run (required)",
      "Notes",
    ]) {
      expect(await screen.findByLabelText(label)).toBeInTheDocument();
    }
    expect(
      screen.getByRole("group", { name: "Coolant level is correct (required)" }),
    ).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("saves every edit on the device at once, as one queued change", async () => {
    const row = await newRecord({ oil_level: "ok" });
    signIn();
    renderApp(`/submissions/${row.id}`);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Site contact"), "Ana");
    await user.selectOptions(screen.getByLabelText("Oil level (required)"), "low");
    await user.type(screen.getByLabelText("Hours run (required)"), "42");
    await user.click(screen.getByRole("radio", { name: "Yes" }));

    await waitFor(async () =>
      expect((await getSubmission(db(), row.id))?.data).toEqual({
        oil_level: "low",
        site_contact: "Ana",
        hours_run: 42,
        coolant_ok: true,
      }),
    );
    // Unsent, so everything joined the create entry.
    expect(await outboxOps()).toHaveLength(1);
    expect(screen.getByLabelText("Site contact")).toHaveValue("Ana");
    expect(screen.getByText("Saved on this device")).toBeInTheDocument();
  });

  it("keeps typing smooth and clears a field when it is emptied", async () => {
    const row = await newRecord({ notes: "abc" });
    signIn();
    renderApp(`/submissions/${row.id}`);
    const user = userEvent.setup();
    const notes = await screen.findByLabelText("Notes");
    await user.clear(notes);
    await waitFor(async () => expect((await getSubmission(db(), row.id))?.data).toEqual({}));
  });

  it("does not save a value the server would refuse, and says why", async () => {
    const row = await newRecord({ hours_run: 5 });
    signIn();
    renderApp(`/submissions/${row.id}`);
    const user = userEvent.setup();
    const hours = await screen.findByLabelText("Hours run (required)");
    await user.clear(hours);
    await user.type(hours, "1.5");
    expect(await screen.findByText("Enter a whole number.")).toBeInTheDocument();
    // Saves run in order, so once this later edit is stored every earlier save has been too.
    await user.type(screen.getByLabelText("Notes"), "x");
    await waitFor(async () => expect((await getSubmission(db(), row.id))?.data.notes).toBe("x"));
    // "1" and "1." were fine and saved as 1; "1.5" is not a whole number and was never saved.
    expect((await getSubmission(db(), row.id))?.data.hours_run).toBe(1);

    await user.clear(hours);
    await user.type(hours, "abc");
    expect(await screen.findByText("Enter a number.")).toBeInTheDocument();
    await user.tab();
    expect(hours).toHaveValue("abc"); // what was typed stays visible while it is wrong
    await user.type(screen.getByLabelText("Notes"), "y");
    await waitFor(async () => expect((await getSubmission(db(), row.id))?.data.notes).toBe("xy"));
    expect((await getSubmission(db(), row.id))?.data.hours_run).toBeUndefined(); // cleared, "abc" never saved
  });

  it("will not submit an incomplete inspection and names the missing fields", async () => {
    const row = await newRecord({ oil_level: "ok" });
    signIn();
    renderApp(`/submissions/${row.id}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Submit inspection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Fix 2 fields before submitting.");
    expect(screen.getAllByText("Required.")).toHaveLength(2);
    // Focus goes to the first field to fix, so a keyboard or screen reader user lands on it.
    // In this form that is the Yes/No question, which comes before "Hours run".
    expect(screen.getByRole("radio", { name: "Yes" })).toHaveFocus();
    expect((await getSubmission(db(), row.id))?.status).toBe("draft");
    expect((await outboxOps()).map(([op]) => op)).toEqual(["create"]);
  });

  it("moves focus to a text field when that is the only field to fix", async () => {
    const row = await newRecord({ oil_level: "ok", coolant_ok: true });
    signIn();
    renderApp(`/submissions/${row.id}`);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Submit inspection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Fix 1 field before submitting.");
    expect(screen.getByRole("textbox", { name: "Hours run (required)" })).toHaveFocus();
  });

  it("submits a complete inspection, queues it and locks the form", async () => {
    const row = await newRecord({ oil_level: "ok", coolant_ok: true, hours_run: 12 });
    signIn();
    renderApp(`/submissions/${row.id}`);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Submit inspection" }));
    expect(await screen.findByText("Submitted. It can no longer be changed.")).toBeInTheDocument();
    expect((await outboxOps()).map(([op]) => op)).toEqual(["create", "submit"]);
    expect(screen.getByLabelText("Notes")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Submit inspection" })).not.toBeInTheDocument();
  });

  it("deletes after confirming and goes back to the list", async () => {
    const row = await newRecord();
    signIn();
    const { router } = renderApp(`/submissions/${row.id}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(await getSubmission(db(), row.id)).toBeUndefined(); // never synced: simply forgotten
  });

  it("is read only for an approved inspection", async () => {
    const row = await newRecord();
    await db().outbox.clear();
    await db().submissions.update(row.id, { status: "approved", syncState: "synced" });
    signIn();
    renderApp(`/submissions/${row.id}`);
    expect(await screen.findByText("Approved. It can no longer be changed.")).toBeInTheDocument();
    expect(screen.getByLabelText("Notes")).toBeDisabled();
  });

  it("puts the form on hold while a conflict waits for a decision", async () => {
    const row = await newRecord({ notes: "mine" });
    await db().submissions.update(row.id, {
      syncState: "conflict",
      syncDetail: "field_conflict",
      serverVersion: 1,
      shadow: {
        data: { notes: "theirs" },
        status: "draft",
        version: 2,
        fieldVersions: {},
        deleted: false,
      },
      conflict: {
        kind: "field_conflict",
        fields: [{ field: "notes", server_value: "theirs", server_version: 2 }],
      },
    });
    signIn();
    renderApp(`/submissions/${row.id}`);
    expect(
      await screen.findByText(
        "Your changes to this inspection are on hold until you decide below.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Needs your decision").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Notes")).toHaveValue("mine");
    expect(screen.getByLabelText("Notes")).toBeDisabled();
  });

  it("explains a rejection", async () => {
    const row = await newRecord();
    await db().submissions.update(row.id, {
      syncState: "rejected",
      syncDetail: "The record is locked.",
    });
    signIn();
    renderApp(`/submissions/${row.id}`);
    expect(
      await screen.findByText(/didn't accept this change: The record is locked\./),
    ).toBeInTheDocument();
  });

  it("says so when the form has not been downloaded yet", async () => {
    const row = await createSubmission(db(), { assignmentId: 1, formVersionId: 9 });
    signIn();
    renderApp(`/submissions/${row.id}`);
    expect(await screen.findByText("The form isn't on this device yet")).toBeInTheDocument();
  });

  it("says so when the inspection does not exist", async () => {
    signIn();
    renderApp("/submissions/not-here");
    expect(await screen.findByText("Inspection not found")).toBeInTheDocument();
  });
});

describe("typing numbers", () => {
  it("keeps a trailing decimal point while the person is still typing", async () => {
    const row = await newRecord();
    signIn();
    renderApp(`/submissions/${row.id}`);
    const user = userEvent.setup();
    const pressure = await screen.findByLabelText("Oil pressure (psi)");
    await user.type(pressure, "41.");
    await waitFor(async () =>
      expect((await getSubmission(db(), row.id))?.data.oil_pressure_psi).toBe(41),
    );
    expect(pressure).toHaveValue("41."); // not shortened to "41" while it is saved
    await user.type(pressure, "5");
    await waitFor(async () =>
      expect((await getSubmission(db(), row.id))?.data.oil_pressure_psi).toBe(41.5),
    );
    await user.tab();
    expect(pressure).toHaveValue("41.5");
  });
});
