import { Link, useSearchParams } from "react-router";
import { listSubmissions, listWorkers, type SubmissionStatus } from "../../admin/api";
import { Button } from "../../components/Button";
import { EmptyState, ErrorState, LoadingState } from "../../components/States";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useRequest } from "../../hooks/useRequest";
import { messageFor } from "../../lib/problem";

const PAGE = 25;
const STATUSES: SubmissionStatus[] = ["submitted", "approved", "returned", "draft"];

export function ReviewQueuePage() {
  useDocumentTitle("Review");
  const [params, setParams] = useSearchParams();
  // The queue is what needs review, so it opens on submitted records.
  const status = params.get("status") ?? "submitted";
  const deleted = (params.get("deleted") ?? "false") as "true" | "false" | "any";
  const worker = params.get("worker") ? Number(params.get("worker")) : undefined;
  const offset = Number(params.get("offset") ?? 0) || 0;

  const workers = useRequest(listWorkers, []);
  const list = useRequest(
    () =>
      listSubmissions({
        status: status === "all" ? undefined : (status as SubmissionStatus),
        worker,
        deleted,
        limit: PAGE,
        offset,
      }),
    [status, deleted, worker, offset],
  );

  function set(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete("offset"); // a new filter starts from the first page
    setParams(next);
  }
  function goto(to: number) {
    const next = new URLSearchParams(params);
    if (to > 0) next.set("offset", String(to));
    else next.delete("offset");
    setParams(next);
  }

  const results = list.data?.results ?? [];
  const count = list.data?.count ?? 0;

  return (
    <div className="page page--wide stack">
      <h1>Review</h1>

      <form className="row filters" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor="f-status">Status</label>
          <select
            id="f-status"
            className="input"
            value={status}
            onChange={(e) => set("status", e.target.value)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0]!.toUpperCase() + s.slice(1)}
              </option>
            ))}
            <option value="all">All statuses</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-worker">Worker</label>
          <select
            id="f-worker"
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
        <div className="field">
          <label htmlFor="f-deleted">Show</label>
          <select
            id="f-deleted"
            className="input"
            value={deleted}
            onChange={(e) => set("deleted", e.target.value === "false" ? "" : e.target.value)}
          >
            <option value="false">Active</option>
            <option value="true">Deleted</option>
            <option value="any">Active and deleted</option>
          </select>
        </div>
      </form>

      {list.loading && <LoadingState />}
      {!list.loading && list.error !== undefined && (
        <ErrorState onRetry={list.reload}>{messageFor(list.error)}</ErrorState>
      )}
      {!list.loading && list.error === undefined && results.length === 0 && (
        <EmptyState title="Nothing here">No submissions match these filters.</EmptyState>
      )}
      {results.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Submissions</caption>
              <thead>
                <tr>
                  <th scope="col">Site</th>
                  <th scope="col">Form</th>
                  <th scope="col">Worker</th>
                  <th scope="col">Status</th>
                  <th scope="col">Updated</th>
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id}>
                    <td>{r.site_name}</td>
                    <td>
                      {r.form_name} v{r.form_version_number}
                    </td>
                    <td>{r.worker.username}</td>
                    <td>
                      {r.status}
                      {r.deleted ? " (deleted)" : ""}
                    </td>
                    <td>{r.updated_at ? new Date(r.updated_at).toLocaleString() : ""}</td>
                    <td>
                      <Link to={`/manage/review/${r.id}`} aria-label={`Review ${r.site_name}`}>
                        Review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="row" aria-label="Pages">
            <span>
              {offset + 1}–{offset + results.length} of {count}
            </span>
            <Button
              variant="secondary"
              small
              disabled={offset === 0}
              onClick={() => goto(Math.max(0, offset - PAGE))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              small
              disabled={offset + PAGE >= count}
              onClick={() => goto(offset + PAGE)}
            >
              Next
            </Button>
          </nav>
        </>
      )}
    </div>
  );
}
