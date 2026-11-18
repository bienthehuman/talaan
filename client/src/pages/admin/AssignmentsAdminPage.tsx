import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import {
  cancelAssignment,
  createAssignment,
  listAssignments,
  listForms,
  listWorkers,
  type Assignment,
} from "../../admin/api";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EmptyState, ErrorState, LoadingState } from "../../components/States";
import { useToast } from "../../components/Toast";
import { TextField } from "../../components/TextField";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useRequest } from "../../hooks/useRequest";
import { fieldErrors, messageFor } from "../../lib/problem";
import { Table } from "../../components/Table";

const PAGE = 25;

export function AssignmentsAdminPage() {
  useDocumentTitle("Assignments");
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const cancelled = (params.get("cancelled") ?? "false") as "true" | "false" | "any";
  const worker = params.get("worker") ? Number(params.get("worker")) : undefined;
  const offset = Number(params.get("offset") ?? 0) || 0;

  const workers = useRequest(listWorkers, []);
  const forms = useRequest(listForms, []);
  const list = useRequest(
    () => listAssignments({ cancelled, worker, limit: PAGE, offset }),
    [cancelled, worker, offset],
  );

  const [versionId, setVersionId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [site, setSite] = useState("");
  const [due, setDue] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  // The server names the model field (`worker`); the form's own checks use the request name.
  const versionError = errors.form_version_id ?? errors.form_version;
  const workerError = errors.worker_id ?? errors.worker;
  const [cancelling, setCancelling] = useState<Assignment | null>(null);

  const versions = (forms.data ?? []).flatMap((f) =>
    f.versions
      .filter((v) => v.published_at)
      .map((v) => ({ id: v.id, label: `${f.name} v${v.number}` })),
  );

  async function create(event: FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!versionId) found.form_version_id = "Choose a form version.";
    if (!workerId) found.worker_id = "Choose a worker.";
    if (!site.trim()) found.site_name = "Enter a site name.";
    setErrors(found);
    setProblem(null);
    if (Object.keys(found).length > 0) return;
    try {
      const made = await createAssignment({
        form_version_id: Number(versionId),
        worker_id: Number(workerId),
        site_name: site.trim(),
        due_date: due || null,
      });
      toast.show(
        `Assigned ${made.form_name} at ${made.site_name} to ${made.worker.username}.`,
        "success",
      );
      setSite("");
      setDue("");
      list.reload();
    } catch (err) {
      const fields = fieldErrors(err);
      if (fields) {
        setErrors(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v[0]!])));
      } else {
        setProblem(messageFor(err));
      }
    }
  }

  async function cancel(assignment: Assignment) {
    setCancelling(null);
    try {
      await cancelAssignment(assignment.id);
      toast.show(`Cancelled ${assignment.site_name}. Existing inspections stay.`, "success");
      list.reload();
    } catch (err) {
      setProblem(messageFor(err));
    }
  }

  function set(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete("offset");
    setParams(next);
  }

  const results = list.data?.results ?? [];
  const count = list.data?.count ?? 0;

  return (
    <div className="page page--wide stack">
      <h1>Assignments</h1>

      <form className="card stack" onSubmit={create} noValidate aria-label="New assignment">
        <h2>New assignment</h2>
        {problem && (
          <div className="alert" role="alert">
            {problem}
          </div>
        )}
        <div className="row filters">
          <div className="field">
            <label htmlFor="a-version">Form version</label>
            <select
              id="a-version"
              className="input"
              value={versionId}
              aria-invalid={versionError ? true : undefined}
              onChange={(e) => setVersionId(e.target.value)}
            >
              <option value="">Choose…</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
            {errors.form_version_id && (
              <span className="field-error">{errors.form_version_id}</span>
            )}
          </div>
          <div className="field">
            <label htmlFor="a-worker">Worker</label>
            <select
              id="a-worker"
              className="input"
              value={workerId}
              aria-invalid={workerError ? true : undefined}
              onChange={(e) => setWorkerId(e.target.value)}
            >
              <option value="">Choose…</option>
              {(workers.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.username}
                </option>
              ))}
            </select>
            {workerError && <span className="field-error">{workerError}</span>}
          </div>
          <TextField
            label="Site"
            value={site}
            error={errors.site_name}
            onChange={(e) => setSite(e.target.value)}
          />
          <TextField
            label="Due date (optional)"
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </div>
        <div>
          <Button type="submit">Assign</Button>
        </div>
      </form>

      <div className="row filters">
        <div className="field">
          <label htmlFor="af-state">Show</label>
          <select
            id="af-state"
            className="input"
            value={cancelled}
            onChange={(e) => set("cancelled", e.target.value === "false" ? "" : e.target.value)}
          >
            <option value="false">Active</option>
            <option value="true">Cancelled</option>
            <option value="any">All</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="af-worker">Worker</label>
          <select
            id="af-worker"
            className="input"
            value={worker ?? ""}
            onChange={(e) => set("worker", e.target.value)}
          >
            <option value="">Everyone</option>
            {(workers.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.username}
              </option>
            ))}
          </select>
        </div>
      </div>

      {list.loading && <LoadingState />}
      {!list.loading && list.error !== undefined && (
        <ErrorState onRetry={list.reload}>{messageFor(list.error)}</ErrorState>
      )}
      {!list.loading && list.error === undefined && results.length === 0 && (
        <EmptyState title="No assignments">Nothing matches these filters.</EmptyState>
      )}
      {results.length > 0 && (
        <>
          <Table caption="Assignments">
            <thead>
              <tr>
                <th scope="col">Site</th>
                <th scope="col">Form</th>
                <th scope="col">Worker</th>
                <th scope="col">Due</th>
                <th scope="col">Inspections</th>
                <th scope="col">State</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {results.map((a) => (
                <tr key={a.id}>
                  <td>{a.site_name}</td>
                  <td>
                    {a.form_name} v{a.form_version_number}
                  </td>
                  <td>{a.worker.username}</td>
                  <td>{a.due_date ?? ""}</td>
                  <td>{a.submissions}</td>
                  <td>{a.cancelled ? "Cancelled" : "Active"}</td>
                  <td>
                    {!a.cancelled && (
                      <Button
                        variant="secondary"
                        small
                        aria-label={`Cancel ${a.site_name}`}
                        onClick={() => setCancelling(a)}
                      >
                        Cancel
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <nav className="row" aria-label="Pages">
            <span>
              {offset + 1}–{offset + results.length} of {count}
            </span>
            <Button
              variant="secondary"
              small
              disabled={offset === 0}
              onClick={() => set("offset", offset - PAGE > 0 ? String(offset - PAGE) : "")}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              small
              disabled={offset + PAGE >= count}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set("offset", String(offset + PAGE));
                setParams(next);
              }}
            >
              Next
            </Button>
          </nav>
        </>
      )}

      <ConfirmDialog
        open={cancelling !== null}
        title="Cancel this assignment?"
        message="The worker can no longer start new inspections for it. Inspections already started stay and still sync."
        confirmLabel="Cancel assignment"
        destructive
        onConfirm={() => cancelling && void cancel(cancelling)}
        onCancel={() => setCancelling(null)}
      />
    </div>
  );
}
