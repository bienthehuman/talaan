import type { ReactNode } from "react";
import { Button } from "./Button";
import styles from "./States.module.css";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <span className={styles.skeleton} aria-hidden="true" />
      <span className={styles.skeleton} aria-hidden="true" />
      <span className={styles.skeleton} aria-hidden="true" />
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`${styles.state} ${styles.empty}`}>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  children = "Try again. If it keeps happening, tell your admin.",
  onRetry,
}: {
  title?: string;
  children?: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div className={styles.state} role="alert">
      <h2>{title}</h2>
      <p>{children}</p>
      {onRetry && <Button onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function ForbiddenState() {
  return (
    <div className={styles.state}>
      <h2>You don't have access to this page</h2>
      <p>Ask an admin if you think you should.</p>
    </div>
  );
}
