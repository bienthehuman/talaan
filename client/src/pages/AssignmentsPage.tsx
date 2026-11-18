import { Link, useNavigate } from "react-router";
import { Button } from "../components/Button";
import { EmptyState, LoadingState } from "../components/States";
import { SyncBadge } from "../components/SyncBadge";
import { createSubmission, type LocalSubmission } from "../db";
import { useLive, useLocalDb } from "../db/useLive";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { statusLabel } from "../lib/status";
import styles from "./AssignmentsPage.module.css";

/** How many of an assignment's inspections show before the rest fold away. */
const RECENT = 5;

interface AssignmentRow {
  id: number;
  form_version_id?: number;
  form_name?: string;
  site_name?: string;
  due_date?: string | null;
  cancelled?: boolean;
}

/** Everything here is read from this device. The sync engine keeps it up to date in the background. */
export function AssignmentsPage() {
  useDocumentTitle("Assignments");
  const db = useLocalDb();
  const navigate = useNavigate();
  const { value, ready } = useLive(
    async () =>
      db
        ? {
            assignments: (await db.assignments.toArray()) as AssignmentRow[],
            submissions: (await db.submissions.toArray()).filter((s) => !s.deleted),
          }
        : { assignments: [], submissions: [] },
    [db],
  );

  async function start(assignment: AssignmentRow) {
    if (!db || assignment.form_version_id === undefined) return;
    const row = await createSubmission(db, {
      assignmentId: assignment.id,
      formVersionId: assignment.form_version_id,
    });
    navigate(`/submissions/${row.id}`);
  }

  if (!ready || !value) {
    return (
      <div className="page">
        <h1>Assignments</h1>
        <LoadingState />
      </div>
    );
  }
  const { assignments, submissions } = value;

  return (
    <div className="page stack">
      <h1>Assignments</h1>
      {assignments.length === 0 && (
        <EmptyState title="No assignments yet">
          When an admin assigns you a form, it will show up here.
        </EmptyState>
      )}
      {assignments.map((assignment) => {
        const mine = submissions
          .filter((s) => s.assignmentId === assignment.id)
          .sort((a, b) => b.updatedAt - a.updatedAt);
        // The newest few, plus anything that needs the worker, stay in view; older ones fold away.
        const shown = mine.filter((s, i) => i < RECENT || needsWorker(s));
        const older = mine.filter((s) => !shown.includes(s));
        const headingId = `assignment-${assignment.id}`;
        return (
          <section key={assignment.id} className="card stack" aria-labelledby={headingId}>
            <div>
              <h2 id={headingId}>{assignment.site_name ?? `Assignment ${assignment.id}`}</h2>
              <p>
                {assignment.form_name}
                {assignment.due_date ? ` · due ${assignment.due_date}` : ""}
                {assignment.cancelled ? " · cancelled" : ""}
              </p>
            </div>
            {!assignment.cancelled && (
              <div>
                <Button variant="secondary" onClick={() => void start(assignment)}>
                  New inspection
                </Button>
              </div>
            )}
            {shown.length > 0 && <InspectionList rows={shown} />}
            {older.length > 0 && (
              <details className={styles.more}>
                <summary>
                  {older.length === 1
                    ? "Show 1 older inspection"
                    : `Show ${older.length} older inspections`}
                </summary>
                <InspectionList rows={older} />
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** A conflict, a refusal or a record returned by an admin is never folded away. */
function needsWorker(s: LocalSubmission): boolean {
  return s.syncState === "conflict" || s.syncState === "rejected" || s.status === "returned";
}

function InspectionList({ rows }: { rows: LocalSubmission[] }) {
  return (
    <ul className="list">
      {rows.map((s) => (
        <li key={s.id} className="list-row">
          <Link className="tap-link" to={`/submissions/${s.id}`}>
            {statusLabel(s.status)} inspection · {new Date(s.updatedAt).toLocaleDateString()}
          </Link>
          <SyncBadge
            state={s.syncState}
            reason={s.syncState === "rejected" ? s.syncDetail : undefined}
          />
        </li>
      ))}
    </ul>
  );
}
