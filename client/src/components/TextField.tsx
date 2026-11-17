import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Button } from "./Button";

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  hint?: string;
  error?: string;
  /** Rendered next to the input (e.g. the show/hide button). */
  adornment?: ReactNode;
}

export function TextField({ label, hint, error, adornment, ...input }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ");
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <span id={hintId} className="field-hint">
          {hint}
        </span>
      )}
      <div className="input-group">
        <input
          id={id}
          className="input"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          {...input}
        />
        {adornment}
      </div>
      {error && (
        <span id={errorId} className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}

/** Password input with a show/hide toggle (design system: every password field has one). */
export function PasswordField(props: Omit<FieldProps, "type" | "adornment">) {
  const [shown, setShown] = useState(false);
  return (
    <TextField
      {...props}
      type={shown ? "text" : "password"}
      adornment={
        <Button
          variant="secondary"
          aria-pressed={shown}
          aria-label={shown ? "Hide password" : "Show password"}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? "Hide" : "Show"}
        </Button>
      }
    />
  );
}
