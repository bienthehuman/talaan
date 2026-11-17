import type { ReactNode } from "react";

interface Props {
  kind: "info" | "warn" | "danger";
  children: ReactNode;
  action?: ReactNode;
}

/** Offline, update-required and storage warnings. `danger` is announced assertively. */
export function Banner({ kind, children, action }: Props) {
  return (
    <div className={`banner banner--${kind}`} role={kind === "danger" ? "alert" : "status"}>
      <span>{children}</span>
      {action}
    </div>
  );
}
