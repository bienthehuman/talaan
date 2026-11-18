import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { checkSchema, getFormVersion, listForms, publishVersion } from "../../admin/api";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ErrorState, LoadingState } from "../../components/States";
import { useToast } from "../../components/Toast";
import { FormFieldInput } from "../../forms/FormFields";
import { parseForm } from "../../forms/schema";
import { useDebounced } from "../../hooks/useDebounced";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useRequest } from "../../hooks/useRequest";
import { fieldErrors, messageFor } from "../../lib/problem";
import styles from "./FormEditorPage.module.css";

/** A starting point for a form with no versions yet. */
const STARTER = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "New form",
  properties: {
    notes: { type: "string", title: "Notes", maxLength: 2000 },
  },
  required: [],
  additionalProperties: false,
};

function tryParse(text: string): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Not valid JSON." };
  }
}

export function FormEditorPage() {
  const { id = "" } = useParams();
  const formId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();
  useDocumentTitle("Edit form");

  const loaded = useRequest(async () => {
    const form = (await listForms()).find((f) => f.id === formId);
    if (!form) return null;
    const latest = form.versions.at(-1);
    const schema = latest ? (await getFormVersion(latest.id)).schema : STARTER;
    return { form, schema, next: (latest?.number ?? 0) + 1 };
  }, [formId]);

  if (loaded.loading) {
    return (
      <div className="page">
        <LoadingState />
      </div>
    );
  }
  if (loaded.error !== undefined) {
    return (
      <div className="page">
        <ErrorState onRetry={loaded.reload}>{messageFor(loaded.error)}</ErrorState>
      </div>
    );
  }
  if (!loaded.data) {
    return (
      <div className="page">
        <ErrorState title="No such form">It may have been removed.</ErrorState>
      </div>
    );
  }
  const { form, schema, next } = loaded.data;
  return (
    <Editor
      key={formId}
      formId={formId}
      name={form.name}
      next={next}
      initial={JSON.stringify(schema, null, 2)}
      onPublished={(n) => {
        toast.show(`Published ${form.name} version ${n}.`, "success");
        navigate("/manage/forms");
      }}
    />
  );
}

function Editor({
  formId,
  name,
  next,
  initial,
  onPublished,
}: {
  formId: number;
  name: string;
  next: number;
  initial: string;
  onPublished: (version: number) => void;
}) {
  const [text, setText] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const settled = useDebounced(text, 400);

  const parsed = tryParse(text);
  const parsedSettled = tryParse(settled);
  // Ask the server what a publish would say, but only about text that has stopped changing.
  const check = useRequest(
    () => ("value" in parsedSettled ? checkSchema(parsedSettled.value) : Promise.resolve(null)),
    [settled],
  );
  const upToDate = settled === text && !check.loading;
  const serverProblems = check.data && !check.data.valid ? check.data.errors : [];
  const canPublish = "value" in parsed && upToDate && check.data?.valid === true;
  const form = "value" in parsed ? parseForm(parsed.value) : null;

  async function publish() {
    setConfirming(false);
    if (!("value" in parsed)) return;
    try {
      const version = await publishVersion(formId, parsed.value);
      onPublished(version.number);
    } catch (err) {
      setProblems(fieldErrors(err)?.schema ?? [messageFor(err)]);
    }
  }

  return (
    <div className="page page--wide stack">
      <p>
        <Link to="/manage/forms">‹ Forms</Link>
      </p>
      <h1>
        {name} · version {next}
      </h1>
      <p>
        Write the form as JSON. Publishing creates version {next}. A published version never
        changes; inspections already started keep the version they began on.
      </p>

      <div className={styles.editor}>
        <div className="stack">
          <div className="field">
            <label htmlFor="schema">Form schema (JSON)</label>
            <textarea
              id="schema"
              className="input code"
              rows={22}
              spellCheck={false}
              value={text}
              aria-invalid={!("value" in parsed) || serverProblems.length > 0 ? true : undefined}
              aria-describedby="schema-status"
              onChange={(e) => {
                setText(e.target.value);
                setProblems([]);
              }}
            />
          </div>
          <div id="schema-status" role="status" className="stack">
            {"error" in parsed && <p className="field-error">Not valid JSON: {parsed.error}</p>}
            {"value" in parsed && !upToDate && <p className="field-hint">Checking…</p>}
            {"value" in parsed && upToDate && check.data?.valid && (
              <p>The server accepts this schema.</p>
            )}
            {"value" in parsed && upToDate && serverProblems.length > 0 && (
              <div>
                <p className="field-error">The server would refuse this schema:</p>
                <ul>
                  {serverProblems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {problems.length > 0 && (
            <div className="alert" role="alert">
              <p>Could not publish:</p>
              <ul>
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="actions">
            <Button disabled={!canPublish} onClick={() => setConfirming(true)}>
              Publish version {next}
            </Button>
          </div>
        </div>

        <section aria-labelledby="preview" className="card stack">
          <h2 id="preview">Preview</h2>
          {form ? (
            <>
              <p className="field-hint">What a worker will see. Nothing here is saved.</p>
              <PreviewFields fields={form.fields} />
            </>
          ) : (
            <p>The preview appears when the schema describes a form.</p>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirming}
        title={`Publish version ${next}?`}
        message="Workers can be assigned it straight away. A published version can never be edited; to change it, publish another."
        confirmLabel="Publish"
        onConfirm={() => void publish()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

function PreviewFields({
  fields,
}: {
  fields: NonNullable<ReturnType<typeof parseForm>>["fields"];
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  return (
    <div className="stack">
      {fields.map((field) => (
        <FormFieldInput
          key={field.name}
          field={field}
          value={values[field.name]}
          onChange={(v) => setValues((s) => ({ ...s, [field.name]: v }))}
        />
      ))}
    </div>
  );
}
