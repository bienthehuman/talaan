import type { ReactNode } from "react";
import styles from "./SyncBadge.module.css";

export type SyncState = "pending" | "syncing" | "synced" | "conflict" | "rejected";

/** Labels from docs/DESIGN_SYSTEM.md section 3. "Saved on this device" and "Synced" must never
 *  look alike: different icon, different words, different colour. */
const LABELS: Record<SyncState, string> = {
  pending: "Saved on this device",
  syncing: "Syncing…",
  synced: "Synced",
  conflict: "Needs your decision",
  rejected: "Not accepted",
};

const ICONS: Record<SyncState, ReactNode> = {
  pending: (
    <path d="M7 18a4 4 0 0 1-.5-7.97A6 6 0 0 1 18 9.5 4.5 4.5 0 0 1 17.5 18H7Zm2-7 6 6m0-6-6 6" />
  ),
  syncing: <path className={styles.spinner} d="M12 4a8 8 0 1 0 8 8" />,
  synced: <path d="m5 12 5 5 9-10" />,
  conflict: <path d="M12 4 2.5 20h19L12 4Zm0 6v5m0 3v.01" />,
  rejected: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-6.4 2.6 12.8 12.8" />,
};

export function SyncBadge({ state, reason }: { state: SyncState; reason?: string }) {
  const label = state === "rejected" && reason ? `${LABELS.rejected}: ${reason}` : LABELS[state];
  return (
    <span className={`${styles.badge} ${styles[state]}`}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {ICONS[state]}
      </svg>
      {label}
    </span>
  );
}
