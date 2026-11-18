import { useId } from "react";
import type { FormField } from "./schema";

interface Props {
  field: FormField;
  /** What to show: the text being typed, or the saved value. */
  value: string | boolean | undefined;
  error?: string;
  disabled?: boolean;
  onChange: (value: string | boolean) => void;
  onBlur?: () => void;
}

/** One form field, chosen by its schema type. Every control has a visible label. */
export function FormFieldInput({ field, value, error, disabled, onChange, onBlur }: Props) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [field.description ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ") || undefined;
  const label = field.required ? `${field.title} (required)` : field.title;

  const common = {
    id,
    disabled,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    onBlur,
  };

  let control;
  if (field.type === "boolean") {
    return (
      <fieldset className="field field--choice" disabled={disabled} aria-describedby={describedBy}>
        <legend>{label}</legend>
        {field.description && (
          <span id={hintId} className="field-hint">
            {field.description}
          </span>
        )}
        <div className="row">
          {[true, false].map((choice) => (
            <label key={String(choice)} className="choice">
              <input
                type="radio"
                name={id}
                checked={value === choice}
                aria-invalid={error ? true : undefined}
                onChange={() => onChange(choice)}
                onBlur={onBlur}
              />
              {choice ? "Yes" : "No"}
            </label>
          ))}
        </div>
        {error && (
          <span id={errorId} className="field-error">
            {error}
          </span>
        )}
      </fieldset>
    );
  }
  if (field.enum) {
    control = (
      <select
        {...common}
        className="input"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose…</option>
        {field.enum.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  } else if (field.type === "string" && (field.maxLength ?? 0) > 200) {
    control = (
      <textarea
        {...common}
        className="input"
        rows={4}
        maxLength={field.maxLength}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  } else {
    const numeric = field.type !== "string";
    control = (
      <input
        {...common}
        className="input"
        type="text"
        inputMode={numeric ? (field.type === "integer" ? "numeric" : "decimal") : undefined}
        maxLength={field.maxLength}
        autoComplete="off"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {field.description && (
        <span id={hintId} className="field-hint">
          {field.description}
        </span>
      )}
      {control}
      {error && (
        <span id={errorId} className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}
