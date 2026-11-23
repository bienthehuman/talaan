import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import {
  createInvite,
  inviteLink,
  listInvites,
  listWorkers,
  newInviteLink,
  revokeInvite,
  type Invite,
  type InviteStatus,
  type InviteWithToken,
} from "../../admin/api";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EmptyState, ErrorState, LoadingState } from "../../components/States";
import { Chip, type Tone } from "../../components/StatusChip";
import { Table } from "../../components/Table";
import { TextField } from "../../components/TextField";
import { useToast } from "../../components/Toast";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useRequest } from "../../hooks/useRequest";
import { ApiError, fieldErrors, messageFor } from "../../lib/problem";
import { formatFull, formatWhen } from "../../lib/when";
import styles from "./WorkersPage.module.css";

const PAGE = 25;

const STATUS: Record<InviteStatus, { label: string; tone: Tone }> = {
  pending: { label: "Waiting", tone: "info" },
  expired: { label: "Expired", tone: "warn" },
  accepted: { label: "Joined", tone: "ok" },
  revoked: { label: "Revoked", tone: "neutral" },
};

const FILTERS: { value: "" | InviteStatus; label: string }[] = [
  { value: "", label: "All" },
  { value: "pending", label: "Waiting" },
  { value: "expired", label: "Expired" },
  { value: "accepted", label: "Joined" },
  { value: "revoked", label: "Revoked" },
];

type Pending = { invite: Invite; action: "new-link" | "revoke" };

function fullName(person: { first_name?: string; last_name?: string }): string {
  return [person.first_name, person.last_name].filter(Boolean).join(" ");
}

export function WorkersPage() {
  useDocumentTitle("Workers");
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") ?? "") as "" | InviteStatus;
  const offset = Number(params.get("offset") ?? 0) || 0;

  const workers = useRequest(listWorkers, []);
  const invites = useRequest(
    () => listInvites({ status: status || undefined, limit: PAGE, offset }),
    [status, offset],
  );

  const [username, setUsername] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  // The one time a link exists on this side: cleared when the admin closes the panel.
  const [shown, setShown] = useState<InviteWithToken | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  async function invite(event: FormEvent) {
    event.preventDefault();
    const name = username.trim();
    setProblem(null);
    if (!name) {
      setErrors({ username: "Enter a username." });
      return;
    }
    setErrors({});
    try {
      const made = await createInvite({
        username: name,
        first_name: first.trim(),
        last_name: last.trim(),
      });
      setShown(made);
      setUsername("");
      setFirst("");
      setLast("");
      invites.reload();
    } catch (err) {
      const fields = fieldErrors(err);
      if (fields) {
        setErrors(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v[0]!])));
      } else {
        setProblem(messageFor(err));
      }
    }
  }

  async function confirm({ invite: target, action }: Pending) {
    setPending(null);
    setProblem(null);
    try {
      if (action === "new-link") {
        setShown(await newInviteLink(target.id));
      } else {
        await revokeInvite(target.id);
        toast.show(
          `Revoked the invite for ${target.username}. Its link no longer works.`,
          "success",
        );
      }
    } catch (err) {
      setProblem(
        err instanceof ApiError && err.problem.code === "invite_closed"
          ? `The invite for ${target.username} was already used or revoked.`
          : messageFor(err),
      );
    }
    invites.reload();
  }

  function set(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name !== "offset") next.delete("offset");
    setParams(next);
  }

  const rows = invites.data?.results ?? [];
  const count = invites.data?.count ?? 0;
  const people = workers.data ?? [];

  return (
    <div className="page page--wide stack">
      <h1>Workers</h1>

      <div className={styles.layout}>
        <div className={`stack ${styles.side}`}>
          {shown ? (
            <LinkPanel invite={shown} onDone={() => setShown(null)} />
          ) : (
            <form
              className={`card stack ${styles.panel}`}
              onSubmit={invite}
              noValidate
              aria-label="Invite a worker"
            >
              <h2>Invite a worker</h2>
              <p className={styles.note}>
                You get a link to send them. They open it, choose a password and can then sign in.
              </p>
              {problem && (
                <div className="alert" role="alert">
                  {problem}
                </div>
              )}
              <div className="stack">
                <TextField
                  label="Username"
                  hint="What they sign in with. Letters, digits and @ . + - _ only."
                  value={username}
                  error={errors.username}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={(e) => setUsername(e.target.value)}
                />
                <TextField
                  label="First name (optional)"
                  value={first}
                  error={errors.first_name}
                  autoComplete="off"
                  onChange={(e) => setFirst(e.target.value)}
                />
                <TextField
                  label="Last name (optional)"
                  value={last}
                  error={errors.last_name}
                  autoComplete="off"
                  onChange={(e) => setLast(e.target.value)}
                />
              </div>
              <div className="actions">
                <Button type="submit">Create invite link</Button>
              </div>
            </form>
          )}
        </div>

        <div className={`stack ${styles.list}`}>
          <section className="stack" aria-labelledby="workers-heading">
            <h2 id="workers-heading">Workers</h2>
            {workers.loading && <LoadingState />}
            {!workers.loading && workers.error !== undefined && (
              <ErrorState onRetry={workers.reload}>{messageFor(workers.error)}</ErrorState>
            )}
            {!workers.loading && workers.error === undefined && people.length === 0 && (
              <EmptyState title="No workers yet">
                Invite one. They appear here once they have set a password.
              </EmptyState>
            )}
            {people.length > 0 && (
              <Table caption="Workers" stack>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Username</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((w) => (
                    <tr key={w.id}>
                      <td data-label="Name">{fullName(w) || "—"}</td>
                      <td data-label="Username">{w.username}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </section>

          <section className="stack" aria-labelledby="invites-heading">
            <h2 id="invites-heading">Invites</h2>
            <div className="row filters">
              <div className="field">
                <label htmlFor="inv-status">Show</label>
                <select
                  id="inv-status"
                  className="input"
                  value={status}
                  onChange={(e) => set("status", e.target.value)}
                >
                  {FILTERS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {invites.loading && <LoadingState />}
            {!invites.loading && invites.error !== undefined && (
              <ErrorState onRetry={invites.reload}>{messageFor(invites.error)}</ErrorState>
            )}
            {!invites.loading && invites.error === undefined && rows.length === 0 && (
              <EmptyState title="No invites">
                {status ? "Nothing matches this filter." : "Invite a worker to get started."}
              </EmptyState>
            )}
            {rows.length > 0 && (
              <>
                <Table caption="Invites" stack>
                  <thead>
                    <tr>
                      <th scope="col">Username</th>
                      <th scope="col">Name</th>
                      <th scope="col">State</th>
                      <th scope="col">When</th>
                      <th scope="col">Invited by</th>
                      <th scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((inv) => (
                      <tr key={inv.id}>
                        <td data-label="Username">{inv.username}</td>
                        <td data-label="Name">{fullName(inv)}</td>
                        <td data-label="State">
                          <Chip tone={STATUS[inv.status].tone}>{STATUS[inv.status].label}</Chip>
                        </td>
                        <td data-label="When">
                          <When invite={inv} />
                        </td>
                        <td data-label="Invited by">{inv.created_by}</td>
                        <td data-label="">
                          {(inv.status === "pending" || inv.status === "expired") && (
                            <div className={styles.rowActions}>
                              <Button
                                variant="secondary"
                                small
                                aria-label={`New link for ${inv.username}`}
                                onClick={() => setPending({ invite: inv, action: "new-link" })}
                              >
                                New link
                              </Button>
                              <Button
                                variant="secondary"
                                small
                                aria-label={`Revoke invite for ${inv.username}`}
                                onClick={() => setPending({ invite: inv, action: "revoke" })}
                              >
                                Revoke
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <nav className="actions" aria-label="Invite pages">
                  <span>
                    {offset + 1}–{offset + rows.length} of {count}
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
                    onClick={() => set("offset", String(offset + PAGE))}
                  >
                    Next
                  </Button>
                </nav>
              </>
            )}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={pending?.action === "new-link"}
        title="Make a new link?"
        message="The link you sent before stops working. The new one works for 7 days."
        confirmLabel="Make new link"
        onConfirm={() => pending && void confirm(pending)}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending?.action === "revoke"}
        title="Revoke this invite?"
        message="The link stops working and nobody can join with it. You can invite the same username again."
        confirmLabel="Revoke invite"
        destructive
        onConfirm={() => pending && void confirm(pending)}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

function When({ invite }: { invite: Invite }) {
  if (invite.status === "accepted" && invite.accepted_at) {
    return (
      <span title={formatFull(invite.accepted_at)}>Joined {formatWhen(invite.accepted_at)}</span>
    );
  }
  if (invite.status === "pending") {
    return <span title={formatFull(invite.expires_at)}>Until {formatWhen(invite.expires_at)}</span>;
  }
  if (invite.status === "expired") {
    return <span title={formatFull(invite.expires_at)}>{formatWhen(invite.expires_at)}</span>;
  }
  return null;
}

/** The link, shown once. Copy puts it on the clipboard; the field is selectable as a fallback. */
function LinkPanel({ invite, onDone }: { invite: InviteWithToken; onDone: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const link = inviteLink(invite.token);
  const who = fullName(invite) || invite.username;

  useEffect(() => heading.current?.focus(), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied("yes");
    } catch {
      field.current?.focus();
      field.current?.select();
      setCopied("no");
    }
  }

  return (
    <section className={`card stack ${styles.panel}`} aria-labelledby="link-heading">
      <h2 id="link-heading" ref={heading} tabIndex={-1}>
        Invite link for {who}
      </h2>
      <p>
        Send this link to {who}. It works once, until {formatFull(invite.expires_at)}. Their
        username is <strong>{invite.username}</strong>.
      </p>
      <div className="field">
        <label htmlFor="invite-link">Invite link</label>
        <input
          id="invite-link"
          ref={field}
          className="input"
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
        />
      </div>
      <p className={styles.note} role="status">
        {copied === "yes" && "Link copied."}
        {copied === "no" && "Couldn't copy. The link is selected: copy it with your keyboard."}
      </p>
      <p className={styles.note}>This link is not shown again. If it gets lost, make a new one.</p>
      <div className="actions">
        <Button onClick={() => void copy()}>Copy link</Button>
        <Button variant="secondary" onClick={onDone}>
          Done
        </Button>
      </div>
    </section>
  );
}
