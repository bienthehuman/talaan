import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  applyResult,
  createSubmission,
  dbFor,
  deleteSubmission,
  editSubmission,
  getSubmission,
  takeBatch,
  type ConflictInfo,
  type ServerRecord,
} from "../db";
import { seedReference } from "../test/fixtures";
import { expectNoA11yViolations, renderApp, signIn } from "../test/utils";

const db = () => dbFor(2); // the signed-in test worker

function theirs(id: string, version: number, data: object, extra: Partial<ServerRecord> = {}) {
  return {
    id,
    assignment_id: 1,
    form_version_id: 1,
    version,
    field_versions: {},
    data,
    status: "draft",
    deleted: false,
    server_seq: 100 + version,
    ...extra,
  } as ServerRecord;
}

/** A record the server holds at version 1 whose first unsent change the server answered with `conflict`. */
async function inConflict(
  data: object,
  act: (id: string) => Promise<void>,
  conflict: ConflictInfo,
  server: (id: string) => ServerRecord,
) {
  await seedReference();
  const row = await createSubmission(db(), {
    assignmentId: 1,
    formVersionId: 1,
    data: data as never,
  });
  await db().outbox.clear();
  await db().submissions.update(row.id, {
    serverVersion: 1,
    syncState: "synced",
    shadow: {
      data: { ...row.data },
      status: "draft",
      version: 1,
      fieldVersions: {},
      deleted: false,
    },
  });
  await act(row.id);
  const [entry] = await takeBatch(db());
  await applyResult(db(), entry!, {
    mutation_id: entry!.mutationId,
    status: "conflict",
    conflict,
    record: server(row.id),
  });
  return row.id;
}

const fieldClash = () =>
  inConflict(
    { notes: "start", oil_level: "ok" },
    async (id) => void (await editSubmission(db(), id, { notes: "mine", hours_run: 7 })),
    {
      kind: "field_conflict",
      fields: [{ field: "notes", server_value: "theirs", server_version: 2 }],
    },
    (id) => theirs(id, 2, { notes: "theirs", oil_level: "ok" }),
  );

describe("a field conflict", () => {
  it("shows the starting value, mine and theirs, and what else will be sent", async () => {
    const id = await fieldClash();
    signIn();
    const { container } = renderApp(`/submissions/${id}`);

    const panel = await screen.findByRole("region", { name: "Needs your decision" });
    const group = within(panel).getByRole("group", { name: "Notes" });
    expect(within(group).getByText("Before either of you: start")).toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: "Keep mine: mine" })).not.toBeChecked();
    expect(within(group).getByRole("radio", { name: "Use theirs: theirs" })).not.toBeChecked();
    expect(within(panel).getByText("Hours run: 7")).toBeInTheDocument();
    expect(screen.getByText("Needs your decision", { selector: "span" })).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("cannot be applied until every field has a choice", async () => {
    const id = await fieldClash();
    signIn();
    renderApp(`/submissions/${id}`);
    const apply = await screen.findByRole("button", { name: "Apply my choices" });
    expect(apply).toBeDisabled();
    expect(screen.getByText("Choose for Notes to continue.")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("radio", { name: "Keep mine: mine" }));
    expect(apply).toBeEnabled();
  });

  it("keeping mine queues one new mutation and the screen goes away", async () => {
    const id = await fieldClash();
    const [original] = await db().outbox.toArray();
    signIn();
    renderApp(`/submissions/${id}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "Keep mine: mine" }));
    await user.click(screen.getByRole("button", { name: "Apply my choices" }));

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Needs your decision" })).toBeNull(),
    );
    const [entry, ...rest] = await db().outbox.toArray();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ baseVersion: 2, fields: { notes: "mine", hours_run: 7 } });
    expect(entry!.mutationId).not.toBe(original!.mutationId);
    expect(screen.getByText("Saved on this device")).toBeInTheDocument();
    expect(screen.getByLabelText("Notes")).toBeEnabled();
  });

  it("using theirs shows the server's value", async () => {
    const id = await fieldClash();
    signIn();
    renderApp(`/submissions/${id}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "Use theirs: theirs" }));
    await user.click(screen.getByRole("button", { name: "Apply my choices" }));
    await waitFor(() => expect(screen.getByLabelText("Notes")).toHaveValue("theirs"));
    expect((await db().outbox.toArray())[0]!.fields).toEqual({ hours_run: 7 });
  });

  it("discarding everything needs a confirmation", async () => {
    const id = await fieldClash();
    signIn();
    renderApp(`/submissions/${id}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Discard all my changes" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.getByLabelText("Notes")).toHaveValue("theirs"));
    expect(await db().outbox.count()).toBe(0);
    expect((await getSubmission(db(), id))!.syncState).toBe("synced");
  });
});

describe("a record deleted on the server", () => {
  const deleted = () =>
    inConflict(
      { notes: "start" },
      async (id) => void (await editSubmission(db(), id, { notes: "mine" })),
      { kind: "deleted_remotely", fields: [] },
      (id) => theirs(id, 2, { notes: "start" }, { deleted: true }),
    );

  it("says what happened, keeps the edits, and offers to discard", async () => {
    const id = await deleted();
    signIn();
    const { container } = renderApp(`/submissions/${id}`);
    const panel = await screen.findByRole("region", { name: "Needs your decision" });
    expect(within(panel).getByText(/An admin deleted this inspection/)).toBeInTheDocument();
    expect(within(panel).getByText(/ask an admin to restore it/)).toBeInTheDocument();
    expect(screen.getByLabelText("Notes")).toHaveValue("mine");
    await expectNoA11yViolations(container);

    const user = userEvent.setup();
    await user.click(within(panel).getByRole("button", { name: "Discard my changes" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Discard" }));
    await waitFor(async () => expect((await getSubmission(db(), id))!.deleted).toBe(true));
  });
});

describe("a delete that would lose someone else's work", () => {
  const editedSince = () =>
    inConflict(
      { notes: "start" },
      async (id) => void (await deleteSubmission(db(), id)),
      {
        kind: "edited_since_base",
        fields: [{ field: "notes", server_value: "theirs", server_version: 2 }],
      },
      (id) => theirs(id, 2, { notes: "theirs" }),
    );

  it("explains it and can keep the inspection", async () => {
    const id = await editedSince();
    signIn();
    const { container } = renderApp(`/submissions/${id}`);
    const panel = await screen.findByRole("region", { name: "Needs your decision" });
    expect(
      within(panel).getByText(/You deleted this inspection, but someone else changed it first/),
    ).toBeInTheDocument();
    expect(within(panel).getByText("Notes is now: theirs")).toBeInTheDocument();
    await expectNoA11yViolations(container);

    await userEvent
      .setup()
      .click(within(panel).getByRole("button", { name: "Keep the inspection" }));
    await waitFor(async () => expect((await getSubmission(db(), id))!.syncState).toBe("synced"));
    expect(await db().outbox.count()).toBe(0);
  });

  it("can delete anyway", async () => {
    const id = await editedSince();
    signIn();
    renderApp(`/submissions/${id}`);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Delete anyway" }));
    await waitFor(async () =>
      expect((await db().outbox.toArray())[0]).toMatchObject({ op: "delete", baseVersion: 2 }),
    );
  });
});
