import { useEffect } from "react";

/** Every route sets a title: "Page · Talaan". */
export function useDocumentTitle(page: string): void {
  useEffect(() => {
    document.title = `${page} · Talaan`;
  }, [page]);
}
