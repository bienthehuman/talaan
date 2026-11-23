import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { createForm, getFormVersion, listForms, saveDraft } from "../../admin/api";
import { Button, buttonClass } from "../../components/Button";
import { EmptyState, ErrorState, LoadingState } from "../../components/States";
import { TextField } from "../../components/TextField";
import { useToast } from "../../components/Toast";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useRequest } from "../../hooks/useRequest";
import { fieldErrors, messageFor } from "../../lib/problem";
import { formatWhen } from "../../lib/when";

export function FormsPage() {
  useDocumentTitle("Forms");
  const navigate = useNavigate();
  const forms = useRequest(listForms, []);
  const toast = useToast();
  const [name, setName] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [error, setError] = useState<string | null>(null);
  // A copy starts from another form's latest published version.
  const copyable = (forms.data ?? []).flatMap((form) => {
    const latest = form.versions.filter((v) => v.published_at).at(-1);
    return latest ? [{ form, latest }] : [];
  });

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    let form;
    try {
      form = await createForm(name.trim());
    } catch (err) {
      setError(fieldErrors(err)?.name?.[0] ?? messageFor(err));
      return;
    }
    if (copyFrom) {
      // The copy becomes the new form's draft; nothing is published until the admin says so.
      try {
        const source = (await getFormVersion(Number(copyFrom))).schema;
        await saveDraft(form.id, { ...(source as object), title: form.name }, 0);
      } catch (err) {
        toast.show(
          `Created ${form.name}, but could not copy the form. ${messageFor(err)}`,
          "error",
        );
      }
    }
    navigate(`/manage/forms/${form.id}/edit`);
  }

  return (
    <div className="page page--wide stack">
      <h1>Forms</h1>

      <form className="card stack" onSubmit={create} noValidate aria-label="New form">
        <h2>New form</h2>
        <TextField
          label="Name"
          value={name}
          error={error ?? undefined}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="field">
          <label htmlFor="copy-from">Start from</label>
          <select
            id="copy-from"
            className="input"
            value={copyFrom}
            onChange={(e) => setCopyFrom(e.target.value)}
          >
            <option value="">A blank form</option>
            {copyable.map(({ form, latest }) => (
              <option key={latest.id} value={latest.id}>
                A copy of {form.name} (version {latest.number})
              </option>
            ))}
          </select>
        </div>
        <div className="actions">
          <Button type="submit" disabled={!name.trim()}>
            Create form
          </Button>
        </div>
      </form>

      {forms.loading && <LoadingState />}
      {!forms.loading && forms.error !== undefined && (
        <ErrorState onRetry={forms.reload}>{messageFor(forms.error)}</ErrorState>
      )}
      {forms.data?.length === 0 && (
        <EmptyState title="No forms yet">
          Create one above, then publish its first version.
        </EmptyState>
      )}
      {forms.data?.map((form) => {
        const latest = form.versions.at(-1);
        return (
          <section key={form.id} className="card stack" aria-labelledby={`form-${form.id}`}>
            <h2 id={`form-${form.id}`}>{form.name}</h2>
            {form.versions.length === 0 ? (
              <p>No versions yet. Workers cannot be assigned this form until one is published.</p>
            ) : (
              <ul className="list">
                {form.versions.map((v) => (
                  <li key={v.id} className="list-row">
                    <span>
                      Version {v.number}
                      {v.published_at
                        ? ` · published ${formatWhen(v.published_at)}`
                        : " · not published (publish it in the Django admin)"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <Link className={buttonClass("secondary")} to={`/manage/forms/${form.id}/edit`}>
                {latest ? "New version" : "Build the first version"}
              </Link>
            </div>
          </section>
        );
      })}
    </div>
  );
}
