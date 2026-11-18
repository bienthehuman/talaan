import type { ReactNode } from "react";
import styles from "./Table.module.css";

/** An admin data table: scrolls sideways on its own on a narrow screen, with a caption for screen readers.
 *  `stack` turns each row into a card below 600 px; its cells then need `data-label` (the column name). */
export function Table({
  caption,
  stack = false,
  children,
}: {
  caption: string;
  stack?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={styles.wrap}>
      <table className={`${styles.table} ${stack ? styles.stack : ""}`}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
