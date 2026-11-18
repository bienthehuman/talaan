import { useEffect, useId, useRef, useState } from "react";
import { Button } from "./Button";
import styles from "./Dialog.module.css";

interface Props {
  open: boolean;
  title: string;
  label: string;
  confirmLabel: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

/** A confirmation that needs a written reason. Native <dialog>, like ConfirmDialog. */
export function ReasonDialog({ open, title, label, confirmLabel, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function confirm() {
    if (!reason.trim()) {
      setError("Enter a reason.");
      return;
    }
    const text = reason.trim();
    setReason("");
    setError(null);
    onConfirm(text);
  }

  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={`${id}-title`} onCancel={onCancel}>
      <h2 id={`${id}-title`}>{title}</h2>
      <div className="field">
        <label htmlFor={`${id}-reason`}>{label}</label>
        <textarea
          id={`${id}-reason`}
          className="input"
          rows={3}
          maxLength={500}
          value={reason}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => setReason(e.target.value)}
        />
        {error && (
          <span id={`${id}-error`} className="field-error">
            {error}
          </span>
        )}
      </div>
      <div className="row">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={confirm}>{confirmLabel}</Button>
      </div>
    </dialog>
  );
}
