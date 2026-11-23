import { useEffect, useId, useRef } from "react";
import { Button } from "../../../components/Button";
import { TextField } from "../../../components/TextField";
import {
  LIMITS,
  SHORT_TEXT_MAX,
  allowedKinds,
  changeKind,
  kindOf,
  setLabel,
  setName,
  updateField,
  type BuilderField,
  type BuilderModel,
  type FieldKind,
} from "../../../forms/builder";
import styles from "./FieldCard.module.css";

/** The builder's field types in plain words (FORM_BUILDER_PLAN.md section 4.7). */
export const KIND_LABELS: Record<FieldKind, string> = {
  short_text: "Short text",
  long_text: "Long text",
  choice: "Choice",
  yes_no: "Yes / No",
  whole_number: "Whole number",
  number: "Number",
};

type Edit = (change: (model: BuilderModel) => BuilderModel) => void;

/** A short visible word ("Move up") with the item it acts on in the accessible name
 *  ("Move up Oil level"), so a screen reader list of buttons makes sense on its own. */
function Named({ text, item }: { text: string; item: string }) {
  return (
    <>
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{`${text} ${item}`}</span>
    </>
  );
}

interface Props {
  field: BuilderField;
  index: number;
  count: number;
  history: BuilderModel["history"];
  problems: string[];
  edit: Edit;
  onMove: (by: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

/** One field of the form. Move buttons at an end stay focusable (aria-disabled), so keyboard focus
 *  is never lost when a card reaches the top or bottom. */
export function FieldCard({
  field,
  index,
  count,
  history,
  problems,
  edit,
  onMove,
  onDuplicate,
  onRemove,
}: Props) {
  const id = useId();
  const kind = kindOf(field);
  const label = field.title?.trim() || "Untitled field";

  return (
    <li className={styles.item}>
      <section
        id={`card-${field.id}`}
        className={`card stack ${problems.length ? styles.invalid : ""}`}
        aria-labelledby={`${id}-heading`}
      >
        <div className={styles.head}>
          <h3 id={`${id}-heading`} className={styles.heading}>
            <span className={styles.number}>{index + 1}.</span> {label}
          </h3>
          <span className={styles.kind}>{KIND_LABELS[kind]}</span>
        </div>

        <TextField
          label="Label"
          hint="The question workers see."
          value={field.title ?? ""}
          maxLength={LIMITS.title + 50}
          onChange={(e) => edit((m) => setLabel(m, field.id, e.target.value))}
        />

        <div className="field">
          <label htmlFor={`${id}-kind`}>Type</label>
          {field.locked && (
            <span id={`${id}-kind-hint`} className="field-hint">
              Published in an earlier version, so it keeps its kind of answer.
            </span>
          )}
          <select
            id={`${id}-kind`}
            className="input"
            value={kind}
            aria-describedby={field.locked ? `${id}-kind-hint` : undefined}
            onChange={(e) => edit((m) => changeKind(m, field.id, e.target.value as FieldKind))}
          >
            {allowedKinds(field, history).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor={`${id}-help`}>Help text (optional)</label>
          <textarea
            id={`${id}-help`}
            className="input"
            rows={2}
            value={field.description ?? ""}
            onChange={(e) => edit((m) => updateField(m, field.id, { description: e.target.value }))}
          />
        </div>

        <label className="choice">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(e) => edit((m) => updateField(m, field.id, { required: e.target.checked }))}
          />
          Required: workers must answer it before submitting
        </label>

        <Settings field={field} kind={kind} edit={edit} />

        <FieldId field={field} edit={edit} />

        {problems.length > 0 && (
          <ul className={styles.problems} aria-label={`Problems with ${label}`}>
            {problems.map((p) => (
              <li key={p} className="field-error">
                {p}
              </li>
            ))}
          </ul>
        )}

        <div className={styles.actions}>
          <Button
            variant="secondary"
            small
            aria-disabled={index === 0 ? true : undefined}
            onClick={() => index > 0 && onMove(-1)}
          >
            <Named text="Move up" item={label} />
          </Button>
          <Button
            variant="secondary"
            small
            aria-disabled={index === count - 1 ? true : undefined}
            onClick={() => index < count - 1 && onMove(1)}
          >
            <Named text="Move down" item={label} />
          </Button>
          <Button variant="secondary" small onClick={onDuplicate}>
            <Named text="Duplicate" item={label} />
          </Button>
          <Button variant="destructive" small onClick={onRemove}>
            <Named text="Remove" item={label} />
          </Button>
        </div>
      </section>
    </li>
  );
}

function Settings({ field, kind, edit }: { field: BuilderField; kind: FieldKind; edit: Edit }) {
  const set = (patch: Parameters<typeof updateField>[2]) =>
    edit((m) => updateField(m, field.id, patch));
  if (kind === "choice") {
    return <ChoicesEditor choices={field.enum ?? []} onChange={(c) => set({ enum: c })} />;
  }
  if (kind === "short_text" || kind === "long_text") {
    return (
      <div className={styles.pair}>
        <NumberField
          label="Longest answer (characters)"
          hint={`Over ${SHORT_TEXT_MAX} makes it long text, with a bigger box.`}
          value={field.maxLength}
          integer
          onChange={(v) => set({ maxLength: v })}
        />
        <NumberField
          label="Shortest answer (optional)"
          value={field.minLength}
          integer
          onChange={(v) => set({ minLength: v })}
        />
      </div>
    );
  }
  if (kind === "whole_number" || kind === "number") {
    return (
      <div className={styles.pair}>
        <NumberField
          label="Smallest value (optional)"
          value={field.minimum}
          integer={kind === "whole_number"}
          onChange={(v) => set({ minimum: v })}
        />
        <NumberField
          label="Largest value (optional)"
          value={field.maximum}
          integer={kind === "whole_number"}
          onChange={(v) => set({ maximum: v })}
        />
      </div>
    );
  }
  return null;
}

function NumberField({
  label,
  hint,
  value,
  integer,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number | undefined;
  integer?: boolean;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <TextField
      label={label}
      hint={hint}
      type="number"
      inputMode={integer ? "numeric" : "decimal"}
      step={integer ? 1 : "any"}
      value={value ?? ""}
      onChange={(e) => {
        const n = e.target.value === "" ? undefined : Number(e.target.value);
        onChange(n === undefined || Number.isNaN(n) ? undefined : n);
      }}
    />
  );
}

/** The field's stable ID. It follows the label until edited here; once published it is fixed. */
function FieldId({ field, edit }: { field: BuilderField; edit: Edit }) {
  const id = useId();
  return (
    <details className={styles.details}>
      <summary className={styles.summary}>
        Field ID: <code className="code">{field.name}</code>
      </summary>
      <div className="field">
        <label htmlFor={id}>Field ID</label>
        <span id={`${id}-hint`} className="field-hint">
          {field.locked
            ? "Published in an earlier version, so it can't change. Answers are stored under it."
            : "Answers are stored under this name. It follows the label until you change it here, and can't change after publishing."}
        </span>
        <input
          id={id}
          className="input code"
          value={field.name}
          readOnly={field.locked}
          spellCheck={false}
          autoCapitalize="none"
          aria-describedby={`${id}-hint`}
          onChange={(e) => edit((m) => setName(m, field.id, e.target.value))}
        />
      </div>
    </details>
  );
}

/** Add, rename, reorder and remove choices. After a move, focus follows the moved choice. */
export function ChoicesEditor({
  choices,
  onChange,
}: {
  choices: string[];
  onChange: (choices: string[]) => void;
}) {
  const id = useId();
  const list = useRef<HTMLOListElement>(null);
  const focus = useRef<{ index: number; part: string } | null>(null);
  const setFocus = (target: { index: number; part: string }) => (focus.current = target);

  // After a move, add or remove, focus follows the choice (runs after the re-render).
  useEffect(() => {
    const target = focus.current;
    if (!target) return;
    focus.current = null;
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${target.index}"][data-part="${target.part}"]`)
      ?.focus();
  });

  function move(from: number, by: number) {
    const to = from + by;
    if (to < 0 || to >= choices.length) return;
    const next = [...choices];
    [next[from], next[to]] = [next[to]!, next[from]!];
    onChange(next);
    setFocus({ index: to, part: by < 0 ? "up" : "down" });
  }

  return (
    <fieldset className={`field field--choice ${styles.choices}`}>
      <legend>Choices</legend>
      <ol ref={list} className={styles.choiceList}>
        {choices.map((choice, i) => {
          const item = choice || `choice ${i + 1}`;
          return (
            <li key={i} className={styles.choiceRow}>
              <input
                className="input"
                aria-label={`Choice ${i + 1}`}
                value={choice}
                maxLength={LIMITS.choice + 20}
                data-index={i}
                data-part="text"
                onChange={(e) => onChange(choices.map((c, j) => (j === i ? e.target.value : c)))}
              />
              <Button
                variant="quiet"
                small
                data-index={i}
                data-part="up"
                aria-disabled={i === 0 ? true : undefined}
                onClick={() => move(i, -1)}
              >
                <Named text="Up" item={item} />
              </Button>
              <Button
                variant="quiet"
                small
                data-index={i}
                data-part="down"
                aria-disabled={i === choices.length - 1 ? true : undefined}
                onClick={() => move(i, 1)}
              >
                <Named text="Down" item={item} />
              </Button>
              <Button
                variant="quiet"
                small
                onClick={() => {
                  onChange(choices.filter((_, j) => j !== i));
                  setFocus({ index: Math.max(0, i - 1), part: "text" });
                }}
              >
                <Named text="Remove" item={item} />
              </Button>
            </li>
          );
        })}
      </ol>
      <div>
        <Button
          variant="secondary"
          small
          aria-describedby={`${id}-limit`}
          onClick={() => {
            onChange([...choices, ""]);
            setFocus({ index: choices.length, part: "text" });
          }}
        >
          Add a choice
        </Button>
        <span id={`${id}-limit`} className="sr-only">
          At most {LIMITS.choices}.
        </span>
      </div>
    </fieldset>
  );
}
