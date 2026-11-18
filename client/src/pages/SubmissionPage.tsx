import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ConflictPanel } from "../components/ConflictPanel";
import { EmptyState, LoadingState } from "../components/States";
import { SyncBadge } from "../components/SyncBadge";
import {
  deleteSubmission,
  discardLocalChanges,
  editSubmission,
  NotEditableError,
  submitSubmission,
  type FieldValue,
  type LocalSubmission,
} from "../db";
import { useLive, useLocalDb } from "../db/useLive";
import { FormFieldInput } from "../forms/FormFields";
import { textToValue } from "../forms/convert";
import { loadForm } from "../forms/local";
import type { FormField } from "../forms/schema";
import { validateRecord, type FieldErrors } from "../forms/validate";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

/** Why the record cannot be edited on this device, or null when it can. */
function lockedReason(row: LocalSubmission): string | null {
  if (row.syncState === "conflict") {
    return "Your changes to this inspection are on hold until you decide below.";
  }
  if (row.syncState === "rejected") {
    return `The server did not accept this change${row.syncDetail ? `: ${row.syncDetail}` : "."} You can discard your changes to see the server's version.`;
  }
  if (row.status === "submitted") return "Submitted. It can't be edited here.";
  if (row.status === "approved") return "Approved and locked.";
  return null;
}

/** Does the saved value say what the typed text says? Numbers must match exactly as written, so "1."
 *  (on the way to "1.5") is kept on screen until the person leaves the field. */
function sameValue(field: FormField, text: string, saved: unknown): boolean {
  if (text.trim() === "") return saved === undefined;
  if (field.type === "string") return saved === text;
  return String(saved) === text.trim();
}

export function SubmissionPage() {
  const { id = "" } = useParams();
  const db = useLocalDb();
  const navigate = useNavigate();
  const { value: row, ready } = useLive(
    () => (db ? db.submissions.get(id) : Promise.resolve(undefined)),
    [db, id],
  );
  const formVersionId = row?.formVersionId;
  const { value: loaded } = useLive(
    () => (db && formVersionId !== undefined ? loadForm(db, formVersionId) : Promise.resolve(null)),
    [db, formVersionId],
  );
  const { value: assignment } = useLive(
    () => (db && row ? db.assignments.get(row.assignmentId) : Promise.resolve(undefined)),
    [db, row?.assignmentId],
  );

  // Text being typed, kept apart from the saved value so typing never waits for IndexedDB.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitErrors, setSubmitErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"delete" | "discard" | null>(null);

  useDocumentTitle(loaded?.name ?? "Inspection");

  if (!ready)
    return (
      <div className="page">
        <LoadingState />
      </div>
    );
  if (!db || !row || row.deleted) {
    return (
      <div className="page">
        <EmptyState title="Inspection not found" action={<Link to="/">Back to assignments</Link>}>
          It may have been deleted.
        </EmptyState>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="page">
        <EmptyState
          title="The form isn't on this device yet"
          action={<Link to="/">Back to assignments</Link>}
        >
          Connect once so the app can download it, then open this inspection again.
        </EmptyState>
      </div>
    );
  }

  const { definition } = loaded;

  // Typed text is dropped as soon as the saved value has caught up with it, never before: until
  // then the person keeps seeing what they typed (no flicker while the write finishes), and a value
  // that was refused stays on screen with its error.
  const caughtUp = definition.fields.flatMap((f) => {
    const text = typed[f.name];
    return text !== undefined && sameValue(f, text, row.data[f.name])
      ? [[f.name, text] as const]
      : [];
  });
  if (caughtUp.length > 0) {
    setTyped((t) => {
      const rest = { ...t };
      // Only if the text is still what was compared: a keystroke may have arrived since.
      for (const [name, text] of caughtUp) if (rest[name] === text) delete rest[name];
      return rest;
    });
  }
  const locked = lockedReason(row);
  const errors = { ...submitErrors, ...fieldErrors };

  function shown(field: FormField): string | boolean | undefined {
    if (field.name in typed) return typed[field.name];
    const saved = row!.data[field.name];
    return field.type === "boolean" || saved === undefined
      ? (saved as boolean | undefined)
      : String(saved);
  }

  async function save(field: FormField, value: FieldValue) {
    try {
      setProblem(null);
      await editSubmission(db!, row!.id, { [field.name]: value });
    } catch (error) {
      setProblem(
        error instanceof NotEditableError
          ? error.message
          : "Could not save on this device. Try again.",
      );
    }
  }

  function change(field: FormField, raw: string | boolean) {
    setSubmitErrors((e) => ({ ...e, [field.name]: "" }));
    if (typeof raw === "boolean") {
      setFieldErrors((e) => ({ ...e, [field.name]: "" }));
      void save(field, raw);
      return;
    }
    setTyped((t) => ({ ...t, [field.name]: raw }));
    const converted = textToValue(field, raw);
    if ("error" in converted) {
      setFieldErrors((e) => ({ ...e, [field.name]: converted.error }));
      return;
    }
    // Only a value the server would accept is saved; otherwise the person sees why, and it stays unsaved.
    const check = validateRecord(
      definition,
      converted.value === null ? {} : { [field.name]: converted.value },
      { complete: false },
    );
    setFieldErrors((e) => ({ ...e, [field.name]: check[field.name] ?? "" }));
    if (!check[field.name]) void save(field, converted.value);
  }

  /** On leaving a field, tidy numbers ("1.50" becomes "1.5") unless the value was refused. */
  function leave(field: FormField) {
    if (fieldErrors[field.name] || field.type === "string") return;
    setTyped((t) => {
      const text = t[field.name];
      if (text === undefined || text.trim() === "" || !Number.isFinite(Number(text))) return t;
      return { ...t, [field.name]: String(Number(text)) };
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (Object.values(fieldErrors).some(Boolean)) {
      setProblem("Fix the highlighted fields before submitting.");
      return;
    }
    const found = validateRecord(definition, row!.data, { complete: true });
    setSubmitErrors(found);
    if (Object.keys(found).length > 0) {
      setProblem(
        `Fix ${Object.keys(found).length === 1 ? "1 field" : `${Object.keys(found).length} fields`} before submitting.`,
      );
      return;
    }
    try {
      setProblem(null);
      await submitSubmission(db!, row!.id);
    } catch (error) {
      setProblem(
        error instanceof NotEditableError
          ? error.message
          : "Could not save on this device. Try again.",
      );
    }
  }

  return (
    <div className="page">
      <p>
        <Link className="tap-link" to="/">
          ‹ Assignments
        </Link>
      </p>
      <h1>{loaded.name}</h1>
      <div className="row">
        {assignment && <span>{String(assignment.site_name ?? "")}</span>}
        <SyncBadge
          state={row.syncState}
          reason={row.syncState === "rejected" ? row.syncDetail : undefined}
        />
      </div>

      {locked && (
        <div className="banner banner--warn" role="status">
          {locked}
        </div>
      )}
      {row.syncState === "conflict" && (
        <ConflictPanel
          db={db}
          row={row}
          definition={definition}
          onDiscard={() => setConfirm("discard")}
        />
      )}
      {problem && (
        <div className="alert" role="alert">
          {problem}
        </div>
      )}

      <form className="stack" onSubmit={submit} noValidate>
        {definition.fields.map((field) => (
          <FormFieldInput
            key={field.name}
            field={field}
            value={shown(field)}
            error={errors[field.name] || undefined}
            disabled={locked !== null}
            onChange={(v) => change(field, v)}
            onBlur={() => leave(field)}
          />
        ))}
        {!locked && (
          <div className="row">
            <Button type="submit">Submit inspection</Button>
            <Button variant="destructive" onClick={() => setConfirm("delete")}>
              Delete
            </Button>
          </div>
        )}
        {row.syncState === "rejected" && (
          <Button variant="secondary" onClick={() => setConfirm("discard")}>
            Discard my changes
          </Button>
        )}
      </form>

      <ConfirmDialog
        open={confirm === "delete"}
        title="Delete this inspection?"
        message="It is removed from your list. An admin can restore it if it was already synced."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          setConfirm(null);
          await deleteSubmission(db, row.id);
          navigate("/");
        }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "discard"}
        title="Discard your changes?"
        message="Your unsent changes to this inspection are deleted from this device and the server's version is shown."
        confirmLabel="Discard"
        destructive
        onConfirm={async () => {
          setConfirm(null);
          await discardLocalChanges(db, row.id);
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
