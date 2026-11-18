import { Link } from "react-router";
import { Button } from "../components/Button";
import { EmptyState, LoadingState } from "../components/States";
import { SyncBadge } from "../components/SyncBadge";
import { formatWhen } from "../lib/when";
import styles from "./SyncStatusPage.module.css";
import { useLive, useLocalDb } from "../db/useLive";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { readStorageState, type StorageState } from "../pwa/storage";
import { describeProblem, describeState } from "../sync/describe";
import { useSyncStatus } from "../sync/status";

const STORAGE_TEXT: Record<StorageState, string> = {
  protected: "Protected. The browser will not clear this device's data when space runs low.",
  "not-protected":
    "Not protected. The browser may clear this device's data if space runs low. Installing the app helps.",
  unsupported: "This browser cannot say whether the data is protected.",
  unknown: "Checking…",
};

const OP_WORD: Record<string, string> = {
  create: "new inspection",
  update: "edit",
  submit: "submit",
  delete: "delete",
};

/** What the sync engine is doing and what is waiting, in words a person can act on. */
export function SyncStatusPage() {
  useDocumentTitle("Sync status");
  const db = useLocalDb();
  const status = useSyncStatus();

  const waiting = useLive(async () => {
    if (!db) return null;
    const [entries, submissions, assignments] = await Promise.all([
      db.outbox.orderBy("seq").toArray(),
      db.submissions.toArray(),
      db.assignments.toArray(),
    ]);
    const bySubmission = new Map(submissions.map((s) => [s.id, s]));
    const site = new Map(
      assignments.map((a) => [a.id, String(a.site_name ?? `Assignment ${a.id}`)]),
    );
    const perRecord = new Map<
      string,
      { id: string; site: string; ops: string[]; attempts: number; lastError: string | null }
    >();
    for (const e of entries) {
      const sub = bySubmission.get(e.recordId);
      const row = perRecord.get(e.recordId) ?? {
        id: e.recordId,
        site: sub ? (site.get(sub.assignmentId) ?? "Inspection") : "Inspection",
        ops: [],
        attempts: 0,
        lastError: null,
      };
      row.ops.push(OP_WORD[e.op] ?? e.op);
      row.attempts = Math.max(row.attempts, e.attempts);
      row.lastError = e.lastError ?? row.lastError;
      perRecord.set(e.recordId, row);
    }
    const needsDecision = submissions
      .filter((s) => (s.syncState === "conflict" || s.syncState === "rejected") && !s.deleted)
      .map((s) => ({ ...s, site: site.get(s.assignmentId) ?? "Inspection" }));
    return { waiting: [...perRecord.values()], needsDecision };
  }, [db]);

  const storage = useLive(readStorageState, []);

  return (
    <div className="page stack">
      <h1>Sync status</h1>

      <section className="card stack" aria-labelledby="sync-summary">
        <h2 id="sync-summary">Summary</h2>
        <dl className="meta">
          <div>
            <dt>Changes waiting to be sent</dt>
            <dd className={`${styles.count} ${status.pending > 0 ? styles.waiting : ""}`}>
              {status.pending}
            </dd>
          </div>
          <div>
            <dt>Last sync</dt>
            <dd>{status.lastSyncAt ? formatWhen(status.lastSyncAt) : "Never"}</dd>
          </div>
          <div>
            <dt>Last problem</dt>
            <dd>{describeProblem(status.lastError)}</dd>
          </div>
        </dl>
        <p role="status">{describeState(status.state, status.pending, status.retryAt)}</p>
        <div>
          <Button
            variant={status.pending > 0 ? "primary" : "secondary"}
            onClick={status.syncNow}
            disabled={status.state === "syncing"}
          >
            Retry now
          </Button>
        </div>
      </section>

      <section className="card stack" aria-labelledby="sync-attention">
        <h2 id="sync-attention">Needs your attention</h2>
        {!waiting.ready && <LoadingState />}
        {waiting.ready && (waiting.value?.needsDecision.length ?? 0) === 0 && (
          <EmptyState title="Nothing needs a decision" />
        )}
        <ul className="list">
          {waiting.value?.needsDecision.map((s) => (
            <li key={s.id} className="list-row">
              <Link className="tap-link" to={`/submissions/${s.id}`}>
                {s.site}
              </Link>
              <SyncBadge
                state={s.syncState}
                reason={s.syncState === "rejected" ? s.syncDetail : undefined}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="card stack" aria-labelledby="sync-waiting">
        <h2 id="sync-waiting">Waiting to be sent</h2>
        {waiting.ready && (waiting.value?.waiting.length ?? 0) === 0 && (
          <EmptyState title="Nothing is waiting" />
        )}
        <ul className="list">
          {waiting.value?.waiting.map((w) => (
            <li key={w.id} className="list-row stack">
              <Link className="tap-link" to={`/submissions/${w.id}`}>
                {w.site}
              </Link>
              <span>
                {w.ops.join(", ")}
                {w.attempts > 0
                  ? ` · tried ${w.attempts} ${w.attempts === 1 ? "time" : "times"}`
                  : ""}
                {w.lastError && !w.lastError.startsWith("conflict:")
                  ? ` · ${describeProblem(w.lastError)}`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card stack" aria-labelledby="sync-storage">
        <h2 id="sync-storage">Storage on this device</h2>
        <p>{STORAGE_TEXT[storage.value ?? "unknown"]}</p>
      </section>
    </div>
  );
}
