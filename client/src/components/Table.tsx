import type { ReactNode } from "react";
import styles from "./Table.module.css";

/** An admin data table: scrolls sideways on its own on a narrow screen, with a caption for screen readers. */
export function Table({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
