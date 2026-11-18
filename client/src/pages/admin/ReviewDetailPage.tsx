import { useState } from "react";
import { Link, useParams } from "react-router";
import {
  act,
  getSubmission,
  type ActionResult,
  type AdminAction,
  type AdminEvent,
  type SubmissionDetail,
} from "../../admin/api";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ReasonDialog } from "../../components/ReasonDialog";
import { EmptyState, ErrorState, LoadingState } from "../../components/States";
import { useToast } from "../../components/Toast";
import { textToValue } from "../../forms/convert";
import { FormFieldInput } from "../../forms/FormFields";
import { formatValue } from "../../forms/format";
import { parseForm, type FormDefinition, type FormField } from "../../forms/schema";
import { validateRecord, type FieldErrors } from "../../forms/validate";
import { statusLabel } from "../../lib/status";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useRequest } from "../../hooks/useRequest";
import { messageFor } from "../../lib/problem";
import styles from "./ReviewDetailPage.module.css";

const KIND_LABEL: Record<string, string> = {
  created: "Created",
  updated: "Edited",
  submitted: "Submitted",
  deleted: "Deleted",
  restored: "Restored",
  approved: "Approved",
  returned: "Returned",
  admin_edited: "Edited by an admin",
  conflict: "Change not applied (conflict)",
  rejected: "Change refused",
};

function describe(event: AdminEvent): string {
  const detail = (event.detail ?? {}) as Record<string, unknown>;
  if (typeof detail.reason === "string") return detail.reason;
  if (typeof detail.code === "string") return `Reason: ${detail.code}`;
  if (typeof detail.kind === "string") return `Kind: ${detail.kind}`;
  if (Array.isArray(detail.fields) && detail.fields.length > 0) {
    return `Fields: ${detail.fields.join(", ")}`;
  }
  return "";
}

function resultMessage(result: ActionResult): string {
  return result.detail ?? "The server did not accept this.";
}

export function ReviewDetailPage() {
  const { id = "" } = useParams();
  const toast = useToast();
  const { data, error, loading, reload } = useRequest(() => getSubmission(id), [id]);
  const [dialog, setDialog] = useState<"return" | "delete" | null>(null);
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useDocumentTitle(data ? `${data.form_name} · ${data.site_name}` : "Review");

  if (loading) {
    return (
      <div className="page">
        <LoadingState />
      </div>
    );
  }
  if (error !== undefined || !data) {
    return (
      <div className="page">
        <ErrorState onRetry={reload}>{messageFor(error)}</ErrorState>
      </div>
    );
  }
  const record: SubmissionDetail = data;
  const form = parseForm(record.schema);

  async function run(
    action: AdminAction,
    extra: { reason?: string; fields?: Record<string, unknown> } = {},
  ) {
    setProblem(null);
    try {
      const result = await act(record.id, action, extra);
      if (result.status === "applied") {
        toast.show(
          {
            approve: "Approved.",
            return: "Sent back to the worker.",
            restore: "Restored.",
            delete: "Deleted.",
            edit: "Answers saved.",
          }[action],
          "success",
        );
        setEditing(false);
        reload();
      } else {
        setProblem(resultMessage(result));
      }
    } catch (err) {
      setProblem(messageFor(err));
    }
  }

  const status = record.status ?? "draft";
  const canApprove = !record.deleted && status === "submitted";
  const canReturn = !record.deleted && (status === "submitted" || status === "approved");

  return (
    <div className="page page--wide stack">
      <p>
        <Link to="/manage/review">‹ Review</Link>
      </p>
      <h1>
        {record.form_name} · {record.site_name}
      </h1>
      <dl className="meta">
        <div>
          <dt>Worker</dt>
          <dd>{record.worker.username}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            {statusLabel(status)}
            {record.deleted ? " (deleted)" : ""}
          </dd>
        </div>
        <div>
          <dt>Form version</dt>
          <dd>{record.form_version_number}</dd>
        </div>
        <div>
          <dt>Record version</dt>
          <dd>{record.version}</dd>
        </div>
      </dl>

      {problem && (
        <div className="alert" role="alert">
          {problem}
        </div>
      )}

      <div className="row" role="group" aria-label="Actions">
        {record.deleted ? (
          <Button onClick={() => void run("restore")}>Restore</Button>
        ) : (
          <>
            {canApprove && <Button onClick={() => void run("approve")}>Approve</Button>}
            {canReturn && (
              <Button variant="secondary" onClick={() => setDialog("return")}>
                Return to worker…
              </Button>
            )}
            {form && !editing && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit answers
              </Button>
            )}
            <Button variant="destructive" onClick={() => setDialog("delete")}>
              Delete
            </Button>
          </>
        )}
      </div>

      <section aria-labelledby="answers" className="card stack">
        <h2 id="answers">Answers</h2>
        {!form && <p>This form's schema cannot be shown.</p>}
        {form && editing && (
          <AnswerEditor
            form={form}
            data={(record.data ?? {}) as Record<string, string | number | boolean>}
            complete={status === "submitted" || status === "approved"}
            onSave={(fields) => run("edit", { fields })}
            onCancel={() => setEditing(false)}
          />
        )}
        {form && !editing && (
          <dl className={styles.answers}>
            {form.fields.map((f) => (
              <div key={f.name}>
                <dt>{f.title}</dt>
                <dd>{formatValue(f, (record.data as Record<string, never>)?.[f.name])}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section aria-labelledby="history" className="card stack">
        <h2 id="history">History</h2>
        {record.events.length === 0 ? (
          <EmptyState title="No history yet" />
        ) : (
          <ol className={styles.history}>
            {record.events.map((e) => (
              <li key={e.id}>
                <strong>{KIND_LABEL[e.kind] ?? e.kind}</strong> · version {e.version}
                {e.actor ? ` · ${e.actor.username}` : ""}
                {e.created_at ? ` · ${new Date(e.created_at).toLocaleString()}` : ""}
                {describe(e) && <div className="field-hint">{describe(e)}</div>}
              </li>
            ))}
          </ol>
        )}
      </section>

      <ReasonDialog
        open={dialog === "return"}
        title="Return to the worker"
        label="Reason (the worker will see this)"
        confirmLabel="Return"
        onConfirm={(reason) => {
          setDialog(null);
          void run("return", { reason });
        }}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        title="Delete this submission?"
        message="It disappears from workers' lists. You can restore it later."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          setDialog(null);
          void run("delete");
        }}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}

function AnswerEditor({
  form,
  data,
  complete,
  onSave,
  onCancel,
}: {
  form: FormDefinition;
  data: Record<string, string | number | boolean>;
  complete: boolean;
  onSave: (fields: Record<string, string | number | boolean | null>) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState<Record<string, string | boolean | undefined>>(() =>
    Object.fromEntries(
      form.fields.map((f) => [
        f.name,
        f.name in data
          ? f.type === "boolean"
            ? (data[f.name] as boolean)
            : String(data[f.name])
          : undefined,
      ]),
    ),
  );
  const [errors, setErrors] = useState<FieldErrors>({});

  function save() {
    const next: Record<string, string | number | boolean> = {};
    const changes: Record<string, string | number | boolean | null> = {};
    const found: FieldErrors = {};
    for (const field of form.fields as FormField[]) {
      const raw = text[field.name];
      let value: string | number | boolean | null;
      if (typeof raw === "boolean") value = raw;
      else {
        const converted = textToValue(field, raw ?? "");
        if ("error" in converted) {
          found[field.name] = converted.error;
          continue;
        }
        value = converted.value;
      }
      if (value !== null) next[field.name] = value;
      if ((field.name in data ? data[field.name] : null) !== value) changes[field.name] = value;
    }
    const checked = { ...validateRecord(form, next, { complete }), ...found };
    setErrors(checked);
    if (Object.keys(checked).length > 0) return;
    if (Object.keys(changes).length === 0) {
      onCancel();
      return;
    }
    onSave(changes);
  }

  return (
    <form
      className="stack"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {form.fields.map((field) => (
        <FormFieldInput
          key={field.name}
          field={field}
          value={text[field.name]}
          error={errors[field.name]}
          onChange={(v) => setText((t) => ({ ...t, [field.name]: v }))}
        />
      ))}
      <div className="row">
        <Button type="submit">Save answers</Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
