import { useState } from "react";
import {
  IncompleteResolutionError,
  loadConflict,
  resolveEditedSinceBase,
  resolveFieldConflict,
  type FieldChoice,
  type LocalSubmission,
  type TalaanDb,
} from "../db";
import { useLive } from "../db/useLive";
import { formatValue } from "../forms/format";
import type { FormDefinition } from "../forms/schema";
import { Button } from "./Button";
import styles from "./ConflictPanel.module.css";

interface Props {
  db: TalaanDb;
  row: LocalSubmission;
  definition: FormDefinition;
  /** Opens the confirmation for throwing this device's changes away. */
  onDiscard: () => void;
}

/** The decision a person has to make when the server did not accept a change because someone else
 *  got there first. Nothing is sent until every choice is made, and nothing is lost until they choose. */
export function ConflictPanel({ db, row, definition, onDiscard }: Props) {
  const { value: conflict } = useLive(() => loadConflict(db, row.id), [db, row.id, row.updatedAt]);
  const [choices, setChoices] = useState<Record<string, FieldChoice>>({});
  const [problem, setProblem] = useState<string | null>(null);

  if (!conflict) return null;
  const title = (name: string) => definition.fields.find((f) => f.name === name)?.title ?? name;
  const field = (name: string) => definition.fields.find((f) => f.name === name);

  async function apply() {
    try {
      setProblem(null);
      await resolveFieldConflict(db, row.id, choices);
    } catch (error) {
      setProblem(
        error instanceof IncompleteResolutionError
          ? "Choose one for every field first."
          : "Could not save your decision on this device. Try again.",
      );
    }
  }

  const undecided = conflict.fields.filter((f) => !choices[f.field]);

  return (
    <section className={`card stack ${styles.conflict}`} aria-labelledby="conflict-title">
      <h2 id="conflict-title">Needs your decision</h2>

      {conflict.kind === "field_conflict" && (
        <>
          <p>
            Someone else changed {conflict.fields.length === 1 ? "a field" : "some fields"} you also
            changed. Nothing was overwritten. Choose what to keep.
          </p>
          {conflict.fields.map((f) => (
            <fieldset key={f.field} className={`field field--choice ${styles.pick}`}>
              <legend>{title(f.field)}</legend>
              <p className="field-hint">
                Before either change: {formatValue(field(f.field), f.start)}
              </p>
              <label className="choice">
                <input
                  type="radio"
                  name={`choice-${f.field}`}
                  checked={choices[f.field] === "mine"}
                  onChange={() => setChoices((c) => ({ ...c, [f.field]: "mine" }))}
                />
                Keep mine: {formatValue(field(f.field), f.mine)}
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name={`choice-${f.field}`}
                  checked={choices[f.field] === "theirs"}
                  onChange={() => setChoices((c) => ({ ...c, [f.field]: "theirs" }))}
                />
                Use theirs: {formatValue(field(f.field), f.theirs)}
              </label>
            </fieldset>
          ))}
          {conflict.carried.length > 0 && (
            <div>
              <p>These other changes of yours will be sent as well:</p>
              <ul>
                {conflict.carried.map((c) => (
                  <li key={c.field}>
                    {title(c.field)}: {formatValue(field(c.field), c.value)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {problem && (
            <p className="field-error" role="alert">
              {problem}
            </p>
          )}
          <div className="actions">
            <Button onClick={() => void apply()} disabled={undecided.length > 0}>
              Apply my choices
            </Button>
            <Button variant="secondary" onClick={onDiscard}>
              Discard all my changes
            </Button>
          </div>
          {undecided.length > 0 && (
            <p className="field-hint">
              {undecided.length === 1
                ? `Choose for ${title(undecided[0]!.field)} to continue.`
                : `${undecided.length} fields still need a choice.`}
            </p>
          )}
        </>
      )}

      {conflict.kind === "deleted_remotely" && (
        <>
          <p>
            An admin deleted this inspection while you were editing it. Your changes are kept on
            this device.
          </p>
          <p>
            To keep working on it, ask an admin to restore it. Your changes are sent again
            automatically once it is back. Or discard them.
          </p>
          <div className="actions">
            <Button variant="secondary" onClick={onDiscard}>
              Discard my changes
            </Button>
          </div>
        </>
      )}

      {conflict.kind === "edited_since_base" && (
        <>
          <p>
            You deleted this inspection, but someone else changed it first. Deleting it now would
            lose their work.
          </p>
          <ul>
            {row.conflict?.fields.map((f) => (
              <li key={f.field}>
                {title(f.field)} is now: {formatValue(field(f.field), f.server_value)}
              </li>
            ))}
          </ul>
          <div className="actions">
            <Button onClick={() => void resolveEditedSinceBase(db, row.id, "keep")}>
              Keep the inspection
            </Button>
            <Button
              variant="destructive"
              onClick={() => void resolveEditedSinceBase(db, row.id, "delete")}
            >
              Delete anyway
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
