import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/Button";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { TextField } from "../../../components/TextField";
import {
  LIMITS,
  addField,
  duplicateField,
  moveField,
  removeField,
  setFormText,
  type BuilderModel,
  type BuilderProblems,
  type FieldKind,
} from "../../../forms/builder";
import { FieldCard, KIND_LABELS } from "./FieldCard";
import styles from "./BuilderPanel.module.css";

type Edit = (change: (model: BuilderModel) => BuilderModel) => void;

const KINDS = Object.keys(KIND_LABELS) as FieldKind[];

/** The Builder tab: the form's title, its fields as cards, and buttons to add a field. */
export function BuilderPanel({
  model,
  problems,
  edit,
}: {
  model: BuilderModel;
  problems: BuilderProblems;
  edit: Edit;
}) {
  const [said, say] = useState("");
  const focusCard = useRef<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const label = (id: string) =>
    model.fields.find((f) => f.id === id)?.title?.trim() || "Untitled field";

  // A new or duplicated card takes focus on its label, so typing can start straight away.
  useEffect(() => {
    if (!focusCard.current) return;
    const card = document.getElementById(`card-${focusCard.current}`);
    focusCard.current = null;
    card?.querySelector("input")?.focus();
    card?.scrollIntoView?.({ block: "nearest" });
  });

  function move(id: string, by: number) {
    const at = model.fields.findIndex((f) => f.id === id) + by;
    edit((m) => moveField(m, id, by));
    say(`${label(id)} moved to position ${at + 1} of ${model.fields.length}.`);
  }

  function add(kind: FieldKind) {
    const result = addField(model, kind);
    edit(() => result.model);
    focusCard.current = result.id;
  }

  function duplicate(id: string) {
    const at = model.fields.findIndex((f) => f.id === id);
    const next = duplicateField(model, id);
    edit(() => next);
    focusCard.current = next.fields[at + 1]?.id ?? null;
  }

  return (
    <div className="stack">
      <section className="card stack" aria-labelledby="form-settings">
        <h2 id="form-settings">Form</h2>
        <TextField
          label="Form title"
          hint="Workers see it at the top of the inspection."
          value={model.title ?? ""}
          maxLength={LIMITS.title + 50}
          onChange={(e) => edit((m) => setFormText(m, { title: e.target.value }))}
        />
        <div className="field">
          <label htmlFor="form-description">Description (optional)</label>
          <textarea
            id="form-description"
            className="input"
            rows={2}
            value={model.description ?? ""}
            onChange={(e) => edit((m) => setFormText(m, { description: e.target.value }))}
          />
        </div>
        <p className={styles.privacy}>
          Everything written here reaches the device of every worker assigned this form. Don't put
          names, phone numbers or other personal details in it.
        </p>
      </section>

      <section className="stack" aria-labelledby="fields-heading">
        <h2 id="fields-heading">
          Fields <span className={styles.count}>({model.fields.length})</span>
        </h2>
        {model.fields.length === 0 ? (
          <p>No fields yet. Add the first one below.</p>
        ) : (
          <ol className={styles.list}>
            {model.fields.map((field, index) => (
              <FieldCard
                key={field.id}
                field={field}
                index={index}
                count={model.fields.length}
                history={model.history}
                problems={problems.fields[field.id] ?? []}
                edit={edit}
                onMove={(by) => move(field.id, by)}
                onDuplicate={() => duplicate(field.id)}
                onRemove={() => setRemoving(field.id)}
              />
            ))}
          </ol>
        )}
        <p role="status" className="sr-only">
          {said}
        </p>
      </section>

      <section className="card stack" aria-labelledby="add-heading">
        <h2 id="add-heading">Add a field</h2>
        <div className={styles.add}>
          {KINDS.map((kind) => (
            <Button key={kind} variant="secondary" onClick={() => add(kind)}>
              {KIND_LABELS[kind]}
            </Button>
          ))}
        </div>
      </section>

      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing ? label(removing) : "this field"}?`}
        message="Answers already given in earlier versions are kept. Workers on the next version won't see this field."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (removing) {
            const name = label(removing);
            edit((m) => removeField(m, removing));
            say(`${name} removed.`);
          }
          setRemoving(null);
        }}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
