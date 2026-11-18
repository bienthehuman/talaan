import type { SubmissionStatus } from "../db/types";
import { statusLabel } from "../lib/status";
import styles from "./StatusChip.module.css";

/** A record's review status (docs/DESIGN_SYSTEM.md section 4): a dot and the word, on a tint. */
const TONE: Record<SubmissionStatus, "neutral" | "info" | "ok" | "warn"> = {
  draft: "neutral",
  submitted: "info",
  approved: "ok",
  returned: "warn",
};

export function StatusChip({
  status,
  deleted = false,
}: {
  status: SubmissionStatus;
  deleted?: boolean;
}) {
  const tone = deleted ? "danger" : TONE[status];
  return (
    <span className={`${styles.chip} ${styles[tone]}`}>
      <span className={styles.dot} aria-hidden="true" />
      {deleted ? `${statusLabel(status)} · deleted` : statusLabel(status)}
    </span>
  );
}
