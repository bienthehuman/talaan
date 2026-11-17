import { EmptyState } from "../components/States";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

/** Placeholder home. Real assignments arrive with the form filler in phase 2. */
export function AssignmentsPage() {
  useDocumentTitle("Assignments");
  return (
    <div className="page">
      <h1>Assignments</h1>
      <EmptyState title="No assignments yet">
        When an admin assigns you a form, it will show up here.
      </EmptyState>
    </div>
  );
}
