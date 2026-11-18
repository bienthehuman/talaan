import type { ReactNode } from "react";
import styles from "./Banner.module.css";

type Kind = "info" | "warn" | "danger";

interface Props {
  kind: Kind;
  children: ReactNode;
  action?: ReactNode;
}

/** The banner look as a class string, for an element that is not a plain banner (the re-auth form). */
export function bannerClass(kind: Kind): string {
  return `${styles.banner} ${styles[kind]}`;
}

/** Offline, update-required and storage warnings. `danger` is announced assertively. */
export function Banner({ kind, children, action }: Props) {
  return (
    <div className={bannerClass(kind)} role={kind === "danger" ? "alert" : "status"}>
      <span>{children}</span>
      {action}
    </div>
  );
}
