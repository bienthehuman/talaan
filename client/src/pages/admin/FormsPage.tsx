import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { createForm, listForms } from "../../admin/api";
import { Button, buttonClass } from "../../components/Button";
import { EmptyState, ErrorState, LoadingState } from "../../components/States";
import { TextField } from "../../components/TextField";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useRequest } from "../../hooks/useRequest";
import { fieldErrors, messageFor } from "../../lib/problem";

export function FormsPage() {
  useDocumentTitle("Forms");
  const navigate = useNavigate();
  const forms = useRequest(listForms, []);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const form = await createForm(name.trim());
      navigate(`/manage/forms/${form.id}/edit`);
    } catch (err) {
      setError(fieldErrors(err)?.name?.[0] ?? messageFor(err));
    }
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
        <div>
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
                        ? ` · published ${new Date(v.published_at).toLocaleDateString()}`
                        : " · draft (publish it in the Django admin)"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <Link className={buttonClass("secondary")} to={`/manage/forms/${form.id}/edit`}>
                {latest ? "New version" : "Write the first version"}
              </Link>
            </div>
          </section>
        );
      })}
    </div>
  );
}
