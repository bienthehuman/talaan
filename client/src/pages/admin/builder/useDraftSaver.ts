import { useCallback, useEffect, useRef, useState } from "react";
import { saveDraft, staleDraft, type FormDraft } from "../../../admin/api";
import { useDebounced } from "../../../hooks/useDebounced";
import { messageFor } from "../../../lib/problem";

export type SaveStatus =
  | { kind: "saved" }
  | { kind: "saving" }
  | { kind: "error"; message: string }
  /** Someone else saved or published in between. `theirs` is null when the draft was published. */
  | { kind: "conflict"; theirs: FormDraft | null };

/** Keeps the form's server draft in step with the editor (ADR 0013).
 *
 *  `current` is the editor's content as compact JSON, or null while it is not a JSON object (the
 *  JSON tab mid-edit). It is saved after `quietMs` without changes, one save at a time, each
 *  carrying the revision the last one returned. A stale revision stops autosave until the admin
 *  chooses: load their version, or save this one over it. Nothing is ever merged. */
export function useDraftSaver({
  formId,
  revision: startRevision,
  current,
  saved: startSaved,
  quietMs = 1500,
}: {
  formId: number;
  revision: number;
  current: string | null;
  saved: string;
  quietMs?: number;
}) {
  const [status, setStatus] = useState<SaveStatus>({ kind: "saved" });
  const [saved, setSavedState] = useState(startSaved);
  const savedRef = useRef(startSaved); // for flush, which may run after a save it waited for
  const setSaved = useCallback((text: string) => {
    savedRef.current = text;
    setSavedState(text);
  }, []);
  const revision = useRef(startRevision);
  const [hasDraft, setHasDraft] = useState(startRevision > 0);
  const busy = useRef<Promise<boolean> | null>(null);
  const failed = useRef<string | null>(null);
  const settled = useDebounced(current, quietMs);

  const save = useCallback(
    async (text: string): Promise<boolean> => {
      while (busy.current) await busy.current;
      const run = (async () => {
        setStatus({ kind: "saving" });
        try {
          const draft = await saveDraft(formId, JSON.parse(text), revision.current);
          revision.current = draft.revision;
          setHasDraft(true);
          failed.current = null;
          setSaved(text);
          setStatus({ kind: "saved" });
          return true;
        } catch (error) {
          const theirs = staleDraft(error);
          failed.current = text;
          setStatus(
            theirs === undefined
              ? { kind: "error", message: messageFor(error) }
              : { kind: "conflict", theirs },
          );
          return false;
        }
      })();
      busy.current = run;
      try {
        return await run;
      } finally {
        busy.current = null;
      }
    },
    [formId, setSaved],
  );

  const conflict = status.kind === "conflict";
  useEffect(() => {
    // Only what the editor still shows: after "load their version" the debounced value is stale.
    if (conflict || settled === null || settled !== current || settled === saved) return;
    if (settled === failed.current) return;
    if (busy.current) return; // the save in flight ends with setSaved, which runs this again
    void save(settled);
  }, [settled, current, saved, conflict, save]);

  return {
    status,
    /** The editor differs from what the server holds. */
    dirty: current !== null && current !== saved,
    /** The server holds a draft of this form. */
    hasDraft,
    /** Save now if needed; the revision to publish, or null when the save failed. */
    async flush(): Promise<number | null> {
      while (busy.current) await busy.current;
      if (current === null) return null;
      if (current !== savedRef.current || revision.current === 0) {
        if (!(await save(current))) return null;
      }
      return revision.current;
    },
    retry() {
      failed.current = null;
      if (current !== null) void save(current);
    },
    /** After a conflict: carry on from their draft. The caller loads its schema into the editor
     *  and passes the compact JSON of what it now shows. */
    takeTheirs(theirs: FormDraft, shown: string) {
      revision.current = theirs.revision;
      setHasDraft(true);
      failed.current = null;
      setSaved(shown);
      setStatus({ kind: "saved" });
    },
    /** After a conflict: save this version over theirs, knowingly. */
    keepMine(theirs: FormDraft) {
      revision.current = theirs.revision;
      failed.current = null;
      if (current !== null) void save(current);
    },
    /** Publish reported a stale revision. */
    conflictWith(theirs: FormDraft | null) {
      setStatus({ kind: "conflict", theirs });
    },
  };
}
