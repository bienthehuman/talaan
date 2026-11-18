import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import styles from "./TextField.module.css";

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  hint?: string;
  error?: string;
  /** Rendered inside the input's right edge (e.g. the show/hide button). */
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
      <div className={`${styles.inputGroup} ${adornment ? styles.adorned : ""}`}>
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

/** Password input with the familiar eye button inside the field (design system: every password field
 *  has a show/hide control). Its name says what it does: "Show password" / "Hide password". */
export function PasswordField(props: Omit<FieldProps, "type" | "adornment">) {
  const [shown, setShown] = useState(false);
  return (
    <TextField
      {...props}
      type={shown ? "text" : "password"}
      adornment={
        <button
          type="button"
          className={styles.reveal}
          aria-pressed={shown}
          aria-label={shown ? "Hide password" : "Show password"}
          onClick={() => setShown((s) => !s)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
            {shown && <path d="m3 3 18 18" />}
          </svg>
        </button>
      }
    />
  );
}
