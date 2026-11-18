import { Link, useSearchParams } from "react-router";
import { listConflicts, listWorkers } from "../../admin/api";
import { Button } from "../../components/Button";
import { EmptyState, ErrorState, LoadingState } from "../../components/States";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useRequest } from "../../hooks/useRequest";
import { messageFor } from "../../lib/problem";
import { Table } from "../../components/Table";
import { formatFull, formatWhen } from "../../lib/when";

const PAGE = 25;

const REASON: Record<string, string> = {
  field_conflict: "Same field changed on two devices",
  deleted_remotely: "Edited a record that was deleted",
  edited_since_base: "Deleted a record that others had edited",
  locked: "Edited a submitted or approved record",
  not_found: "Record not found",
  invalid: "Failed validation",
  invalid_state: "Not allowed in the record's state",
  unknown_form_version: "Unknown form version",
  forbidden: "Not allowed for this role",
  id_taken: "Id already in use",
  mutation_id_reuse: "Mutation id reused",
};

export function ConflictLogPage() {
  useDocumentTitle("Conflict log");
  const [params, setParams] = useSearchParams();
  const kind = (params.get("kind") || undefined) as "conflict" | "rejected" | undefined;
  const since = (params.get("changed_since") || undefined) as "true" | "false" | undefined;
  const worker = params.get("worker") ? Number(params.get("worker")) : undefined;
  const offset = Number(params.get("offset") ?? 0) || 0;

  const workers = useRequest(listWorkers, []);
  const list = useRequest(
    () => listConflicts({ kind, changed_since: since, worker, limit: PAGE, offset }),
    [kind, since, worker, offset],
  );

  function set(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete("offset");
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
      <h1>Conflict log</h1>
      <p>
        Changes a worker made that the server did not apply. The server cannot see what the worker
        then did on their device, so "Changed since" only says whether they changed the record on
        the server afterwards.
      </p>

      <form className="row filters" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor="c-kind">Kind</label>
          <select
            id="c-kind"
            className="input"
            value={kind ?? ""}
            onChange={(e) => set("kind", e.target.value)}
          >
            <option value="">Conflicts and rejections</option>
            <option value="conflict">Conflicts</option>
            <option value="rejected">Rejections</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="c-since">Changed since</label>
          <select
            id="c-since"
            className="input"
            value={since ?? ""}
            onChange={(e) => set("changed_since", e.target.value)}
          >
            <option value="">Either</option>
            <option value="false">No later change from the worker</option>
            <option value="true">Worker changed it since</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="c-worker">Worker</label>
          <select
            id="c-worker"
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
      </form>

      {list.loading && <LoadingState />}
      {!list.loading && list.error !== undefined && (
        <ErrorState onRetry={list.reload}>{messageFor(list.error)}</ErrorState>
      )}
      {!list.loading && list.error === undefined && results.length === 0 && (
        <EmptyState title="Nothing logged">
          No conflicts or rejections match these filters.
        </EmptyState>
      )}
      {results.length > 0 && (
        <>
          <Table caption="Conflict log">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Worker</th>
                <th scope="col">Site</th>
                <th scope="col">What happened</th>
                <th scope="col">Fields</th>
                <th scope="col">Changed since</th>
                <th scope="col">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {results.map((c) => (
                <tr key={c.id}>
                  <td>
                    <time dateTime={c.created_at} title={formatFull(c.created_at)}>
                      {formatWhen(c.created_at)}
                    </time>
                  </td>
                  <td>{c.worker.username}</td>
                  <td>{c.site_name}</td>
                  <td>
                    {c.kind === "conflict" ? "Conflict" : "Rejected"}:{" "}
                    {REASON[c.reason] ?? c.reason}
                  </td>
                  <td>{c.fields.join(", ")}</td>
                  <td>{c.changed_since ? "Yes" : "No"}</td>
                  <td>
                    <Link
                      to={`/manage/review/${c.submission_id}`}
                      aria-label={`Open ${c.site_name} record`}
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <nav className="actions" aria-label="Pages">
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
