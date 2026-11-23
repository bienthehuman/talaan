import { useEffect, useState, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  checkSchema,
  getDraft,
  getFormVersion,
  listForms,
  publishDraft,
  staleDraft,
  type FormDraft,
  type SchemaChange,
} from "../../admin/api";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ErrorState, LoadingState } from "../../components/States";
import { useToast } from "../../components/Toast";
import {
  checkBuilder,
  emptyModel,
  fromSchema,
  hasProblems,
  toSchema,
  type BuilderModel,
  type SchemaType,
} from "../../forms/builder";
import { FormFieldInput } from "../../forms/FormFields";
import { parseForm } from "../../forms/schema";
import { useDebounced } from "../../hooks/useDebounced";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useRequest } from "../../hooks/useRequest";
import { fieldErrors, messageFor } from "../../lib/problem";
import { formatWhen } from "../../lib/when";
import { BuilderPanel } from "./builder/BuilderPanel";
import { useDraftSaver } from "./builder/useDraftSaver";
import styles from "./FormEditorPage.module.css";

type History = Record<string, SchemaType>;

/** What the editor shows: the builder's model, or the JSON text (with why the builder can't show
 *  it, when that is why the JSON tab is open). Both describe the same draft. */
type Doc = { tab: "builder"; model: BuilderModel } | { tab: "json"; text: string; why?: string };

const pretty = (schema: unknown) => JSON.stringify(schema, null, 2);

function openDoc(schema: unknown, history: History): Doc {
  const read = fromSchema(schema, history);
  return "model" in read
    ? { tab: "builder", model: read.model }
    : { tab: "json", text: pretty(schema), why: read.error };
}

function parseJson(text: string): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Not valid JSON." };
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The draft as compact JSON, or null while the JSON tab holds something that is not an object. */
function compact(doc: Doc): string | null {
  if (doc.tab === "builder") return JSON.stringify(toSchema(doc.model));
  const parsed = parseJson(doc.text);
  return "value" in parsed && isObject(parsed.value) ? JSON.stringify(parsed.value) : null;
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
    const published = form.versions.filter((v) => v.published_at);
    const [schemas, draft] = await Promise.all([
      Promise.all(published.map(async (v) => (await getFormVersion(v.id)).schema)),
      getDraft(formId),
    ]);
    // Every name the form has published keeps its type (ADR 0013); the builder locks those names.
    const history: History = {};
    for (const schema of schemas) {
      const properties = isObject(schema) && isObject(schema.properties) ? schema.properties : {};
      for (const [name, spec] of Object.entries(properties)) {
        if (isObject(spec) && typeof spec.type === "string")
          history[name] = spec.type as SchemaType;
      }
    }
    return {
      form,
      draft,
      history,
      latest: schemas.at(-1),
      previous: published.at(-1)?.number ?? null,
      next: (form.versions.at(-1)?.number ?? 0) + 1,
    };
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
  const { form, draft, history, latest, previous, next } = loaded.data;
  return (
    <Editor
      key={formId}
      formId={formId}
      name={form.name}
      next={next}
      previous={previous}
      history={history}
      draft={draft}
      source={draft?.schema ?? latest ?? toSchema(emptyModel(form.name, history))}
      onReload={loaded.reload}
      onPublished={(n) => {
        toast.show(`Published ${form.name} version ${n}.`, "success");
        navigate("/manage/forms");
      }}
    />
  );
}

interface EditorProps {
  formId: number;
  name: string;
  next: number;
  previous: number | null;
  history: History;
  draft: FormDraft | null;
  source: unknown;
  onReload: () => void;
  onPublished: (version: number) => void;
}

function Editor({
  formId,
  name,
  next,
  previous,
  history,
  draft,
  source,
  onReload,
  onPublished,
}: EditorProps) {
  const [start] = useState(() => {
    const doc = openDoc(source, history);
    return { doc, text: compact(doc) ?? "" };
  });
  const [doc, setDoc] = useState<Doc>(start.doc);
  const [confirming, setConfirming] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const current = compact(doc);
  const saver = useDraftSaver({
    formId,
    revision: draft?.revision ?? 0,
    current,
    saved: start.text,
  });
  const { status } = saver;

  // Ask the server what a publish would say, but only about content that has stopped changing.
  const settled = useDebounced(current, 400);
  const check = useRequest(
    () => (settled === null ? Promise.resolve(null) : checkSchema(JSON.parse(settled), formId)),
    [settled],
  );
  const upToDate = settled === current && !check.loading;
  const serverProblems = upToDate && check.data && !check.data.valid ? check.data.errors : [];
  const builderProblems = doc.tab === "builder" ? checkBuilder(doc.model) : null;
  const builderBlocks = builderProblems !== null && hasProblems(builderProblems);
  const conflict = status.kind === "conflict";
  const nothingToPublish = !saver.hasDraft && !saver.dirty;
  const canPublish =
    current !== null &&
    upToDate &&
    check.data?.valid === true &&
    !builderBlocks &&
    !conflict &&
    !nothingToPublish &&
    !publishing;

  const unsaved = saver.dirty || status.kind === "saving";
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const preview = current === null ? null : parseForm(JSON.parse(current));

  function edit(change: (model: BuilderModel) => BuilderModel) {
    setDoc((d) => (d.tab === "builder" ? { tab: "builder", model: change(d.model) } : d));
    setProblems([]);
  }

  function showTab(tab: Doc["tab"]) {
    if (tab === doc.tab) return;
    if (doc.tab === "builder") {
      setDoc({ tab: "json", text: pretty(toSchema(doc.model)) });
      return;
    }
    const parsed = parseJson(doc.text);
    if ("error" in parsed) {
      setDoc({ ...doc, why: `The text isn't valid JSON: ${parsed.error}` });
      return;
    }
    setDoc(openDoc(parsed.value, history));
  }

  function loadTheirs(theirs: FormDraft) {
    const opened = openDoc(theirs.schema, history);
    setDoc(opened);
    saver.takeTheirs(theirs, compact(opened) ?? "");
  }

  async function publish() {
    setConfirming(false);
    setProblems([]);
    setPublishing(true);
    const revision = await saver.flush();
    if (revision === null) {
      setPublishing(false);
      return; // the save status says why
    }
    try {
      const version = await publishDraft(formId, revision);
      onPublished(version.number);
    } catch (err) {
      const theirs = staleDraft(err);
      if (theirs !== undefined) saver.conflictWith(theirs);
      else setProblems(fieldErrors(err)?.schema ?? [messageFor(err)]);
      setPublishing(false);
    }
  }

  return (
    <div className="page page--wide stack">
      <p>
        <Link className="tap-link" to="/manage/forms">
          ‹ Forms
        </Link>
      </p>
      <h1>
        {name} · version {next}
      </h1>
      <p>
        Your work is saved as a draft as you go, and only admins see it. Publishing makes version{" "}
        {next}, which never changes; inspections already started keep the version they began on.
      </p>
      {draft && (
        <p className={styles.note}>
          Continuing the draft {draft.updated_by ?? "an admin"} saved {formatWhen(draft.updated_at)}
          .
          {previous !== null && draft.based_on_version !== previous && (
            <>
              {" "}
              It was started from{" "}
              {draft.based_on_version === null
                ? "a blank form"
                : `version ${draft.based_on_version}`}
              ; version {previous} has been published since, and the changes below compare with it.
            </>
          )}
        </p>
      )}

      <SaveLine status={status} dirty={saver.dirty} onRetry={saver.retry} />
      {conflict && (
        <ConflictNotice
          theirs={status.theirs}
          onLoadTheirs={loadTheirs}
          onKeepMine={saver.keepMine}
          onReload={onReload}
        />
      )}

      <div className={styles.editor}>
        <div className="stack">
          <Tabs tab={doc.tab} onChange={showTab} />
          <div
            role="tabpanel"
            id={`panel-${doc.tab}`}
            aria-labelledby={`tab-${doc.tab}`}
            className={styles.panel}
          >
            {doc.tab === "builder" ? (
              <BuilderPanel model={doc.model} problems={builderProblems!} edit={edit} />
            ) : (
              <JsonPanel
                text={doc.text}
                why={doc.why}
                invalid={current === null || serverProblems.length > 0}
                onChange={(text) => {
                  setDoc({ tab: "json", text, why: doc.why });
                  setProblems([]);
                }}
              />
            )}
          </div>
        </div>

        <div className={`stack ${styles.side}`}>
          <section aria-labelledby="publish-heading" className="card stack">
            <h2 id="publish-heading">Publish</h2>
            <div id="schema-status" role="status" className="stack">
              {current === null ? (
                <p className="field-error">Fix the JSON before this form can be published.</p>
              ) : builderBlocks ? (
                <BuilderSummary problems={builderProblems!} />
              ) : !upToDate ? (
                <p className="field-hint">Checking…</p>
              ) : serverProblems.length > 0 ? (
                <div>
                  <p className="field-error">This form can't be published yet:</p>
                  <ul>
                    {serverProblems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              ) : check.data?.valid && nothingToPublish ? (
                <p>Make a change to publish version {next}.</p>
              ) : check.data?.valid ? (
                <p>This form is ready to publish.</p>
              ) : null}
            </div>
            {previous !== null && upToDate && check.data && (
              <Changes previous={previous} changes={check.data.changes} />
            )}
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
              <Button
                disabled={!canPublish}
                aria-busy={publishing || undefined}
                onClick={() => setConfirming(true)}
              >
                Publish version {next}
              </Button>
            </div>
          </section>

          <section aria-labelledby="preview" className="card stack">
            <h2 id="preview">Preview</h2>
            {preview ? (
              <>
                <p className="field-hint">What a worker will see. Nothing here is saved.</p>
                <PreviewFields fields={preview.fields} />
              </>
            ) : (
              <p>The preview appears once the JSON describes a form.</p>
            )}
          </section>
        </div>
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

/** Builder and JSON are tabs over the same draft. Arrow keys move between them (ARIA tabs). */
function Tabs({ tab, onChange }: { tab: Doc["tab"]; onChange: (tab: Doc["tab"]) => void }) {
  const tabs = [
    { id: "builder", label: "Builder" },
    { id: "json", label: "JSON (advanced)" },
  ] as const;
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const to = tab === "builder" ? "json" : "builder";
    const target = event.key === "Home" ? "builder" : event.key === "End" ? "json" : to;
    onChange(target);
    document.getElementById(`tab-${target}`)?.focus();
  }
  return (
    <div role="tablist" aria-label="Editor" className={styles.tabs}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`tab-${t.id}`}
          className={styles.tab}
          aria-selected={tab === t.id}
          aria-controls={`panel-${t.id}`}
          tabIndex={tab === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={onKeyDown}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function JsonPanel({
  text,
  why,
  invalid,
  onChange,
}: {
  text: string;
  why?: string;
  invalid: boolean;
  onChange: (text: string) => void;
}) {
  const parsed = parseJson(text);
  return (
    <div className="stack">
      {why && (
        <p className={styles.note} id="json-why">
          The builder can't show this form. {why} Fix it here, then switch to the Builder tab.
        </p>
      )}
      <div className="field">
        <label htmlFor="schema">Form schema (JSON)</label>
        <textarea
          id="schema"
          className="input code"
          rows={22}
          spellCheck={false}
          value={text}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={why ? "json-error json-why" : "json-error"}
          onChange={(e) => onChange(e.target.value)}
        />
        <span id="json-error" className="field-error">
          {"error" in parsed
            ? `The text isn't valid JSON: ${parsed.error}`
            : isObject(parsed.value)
              ? ""
              : "The form must be a JSON object."}
        </span>
      </div>
    </div>
  );
}

function SaveLine({
  status,
  dirty,
  onRetry,
}: {
  status: ReturnType<typeof useDraftSaver>["status"];
  dirty: boolean;
  onRetry: () => void;
}) {
  let text = "";
  if (status.kind === "saving") text = "Saving draft…";
  else if (status.kind === "error") text = `Couldn't save the draft. ${status.message}`;
  else if (status.kind === "saved") text = dirty ? "Changes not saved yet." : "Draft saved.";
  return (
    <div className={styles.saveLine}>
      <p role="status" className={status.kind === "error" ? "field-error" : "field-hint"}>
        {status.kind === "conflict" ? "" : text}
      </p>
      {status.kind === "error" && (
        <Button variant="secondary" small onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

function ConflictNotice({
  theirs,
  onLoadTheirs,
  onKeepMine,
  onReload,
}: {
  theirs: FormDraft | null;
  onLoadTheirs: (theirs: FormDraft) => void;
  onKeepMine: (theirs: FormDraft) => void;
  onReload: () => void;
}) {
  if (theirs === null) {
    return (
      <div className="alert stack" role="alert">
        <p>
          Someone published this form while you were editing, so your latest changes were not saved.
          Copy anything you need from the JSON tab, then reload to start from the new version.
        </p>
        <div className="actions">
          <Button onClick={onReload}>Reload</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="alert stack" role="alert">
      <p>
        {theirs.updated_by ?? "Another admin"} saved this draft at {formatWhen(theirs.updated_at)}{" "}
        while you were editing, so your latest changes were not saved. Nothing has been overwritten.
      </p>
      <div className="actions">
        <Button variant="secondary" onClick={() => onLoadTheirs(theirs)}>
          Load their version
        </Button>
        <Button onClick={() => onKeepMine(theirs)}>Keep mine (replace theirs)</Button>
      </div>
    </div>
  );
}

function BuilderSummary({ problems }: { problems: ReturnType<typeof checkBuilder> }) {
  const cards = Object.keys(problems.fields).length;
  return (
    <div>
      <p className="field-error">This form can't be published yet:</p>
      <ul>
        {problems.form.map((p) => (
          <li key={p}>{p}</li>
        ))}
        {cards > 0 && (
          <li>
            {cards === 1 ? "One field has" : `${cards} fields have`} problems, marked on the{" "}
            {cards === 1 ? "card" : "cards"}.
          </li>
        )}
      </ul>
    </div>
  );
}

const LEVELS: Record<SchemaChange["level"], { label: string; className: string | undefined }> = {
  refused: { label: "Not allowed", className: styles.refused },
  review: { label: "Check", className: styles.review },
  safe: { label: "Safe", className: styles.safe },
};

/** What publishing changes for workers, compared with the last published version (4.3). */
function Changes({ previous, changes }: { previous: number; changes: SchemaChange[] }) {
  return (
    <div className="stack">
      <h3 className={styles.changesHeading}>Changes from version {previous}</h3>
      {changes.length === 0 ? (
        <p>No changes.</p>
      ) : (
        <ul className={styles.changes}>
          {changes.map((c, i) => (
            <li key={i} className={styles.change}>
              <span className={`${styles.level} ${LEVELS[c.level].className}`}>
                {LEVELS[c.level].label}
              </span>
              <span>{c.message}</span>
            </li>
          ))}
        </ul>
      )}
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
