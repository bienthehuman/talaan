import type { ReactNode } from "react";
import type { SubmissionStatus } from "../db/types";
import { statusLabel } from "../lib/status";
import styles from "./StatusChip.module.css";

/** A record's review status (docs/DESIGN_SYSTEM.md section 4): a dot and the word, on a tint. */
const TONE: Record<SubmissionStatus, Tone> = {
  draft: "neutral",
  submitted: "info",
  approved: "ok",
  returned: "warn",
};

export type Tone = "neutral" | "info" | "ok" | "warn" | "danger";

/** A dot and a word on a tint, for any short state. */
export function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`${styles.chip} ${styles[tone]}`}>
      <span className={styles.dot} aria-hidden="true" />
      {children}
    </span>
  );
}

export function StatusChip({
  status,
  deleted = false,
}: {
  status: SubmissionStatus;
  deleted?: boolean;
}) {
  return (
    <Chip tone={deleted ? "danger" : TONE[status]}>
      {deleted ? `${statusLabel(status)} · deleted` : statusLabel(status)}
    </Chip>
  );
}
