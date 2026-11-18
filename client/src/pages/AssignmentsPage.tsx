import { Link, useNavigate } from "react-router";
import { Button } from "../components/Button";
import { EmptyState, LoadingState } from "../components/States";
import { SyncBadge } from "../components/SyncBadge";
import { createSubmission } from "../db";
import { useLive, useLocalDb } from "../db/useLive";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

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
            {mine.length > 0 && (
              <ul className="list">
                {mine.map((s) => (
                  <li key={s.id} className="list-row">
                    <Link to={`/submissions/${s.id}`}>
                      {s.status === "draft"
                        ? "Draft"
                        : s.status[0]!.toUpperCase() + s.status.slice(1)}{" "}
                      inspection · {new Date(s.updatedAt).toLocaleDateString()}
                    </Link>
                    <SyncBadge
                      state={s.syncState}
                      reason={s.syncState === "rejected" ? s.syncDetail : undefined}
                    />
                  </li>
                ))}
              </ul>
            )}
            {!assignment.cancelled && (
              <div>
                <Button variant="secondary" onClick={() => void start(assignment)}>
                  New inspection
                </Button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
