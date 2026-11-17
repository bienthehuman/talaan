import { useState } from "react";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SyncBadge, type SyncState } from "../components/SyncBadge";
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from "../components/States";
import { PasswordField, TextField } from "../components/TextField";
import { useToast } from "../components/Toast";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

const TOKENS = [
  "bg",
  "surface",
  "text",
  "text-muted",
  "border",
  "accent",
  "ok",
  "warn",
  "danger",
] as const;
const STATES: SyncState[] = ["pending", "syncing", "synced", "conflict", "rejected"];

/** Every component in light and dark. Target of the axe gate (docs/DESIGN_SYSTEM.md section 4).
 *  Only routed in development or when VITE_STYLEGUIDE=1, never in a production build. */
export function StyleguidePage() {
  useDocumentTitle("Style guide");
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="page page--wide stack">
      <h1>Style guide</h1>

      <section aria-labelledby="sg-colours" className="stack">
        <h2 id="sg-colours">Colours</h2>
        <div className="swatches">
          {TOKENS.map((t) => (
            <div className="swatch" key={t}>
              <i style={{ background: `var(--${t})` }} />
              --{t}
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="sg-type" className="stack">
        <h2 id="sg-type">Type</h2>
        <p>Body text is 16 px with a 1.5 line height.</p>
        <p style={{ color: "var(--text-muted)" }}>Muted text for secondary information.</p>
      </section>

      <section aria-labelledby="sg-buttons" className="stack">
        <h2 id="sg-buttons">Buttons</h2>
        <div className="row">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="destructive">Destructive</Button>
          <Button disabled>Disabled</Button>
          <Button small>Small</Button>
        </div>
      </section>

      <section aria-labelledby="sg-fields" className="stack">
        <h2 id="sg-fields">Fields</h2>
        <TextField label="Site name" hint="As written on the assignment." />
        <TextField label="Oil level" error="Choose a level before you submit." />
        <PasswordField label="Password" />
      </section>

      <section aria-labelledby="sg-badges" className="stack">
        <h2 id="sg-badges">Sync badges</h2>
        <div className="row">
          {STATES.map((s) => (
            <SyncBadge key={s} state={s} reason={s === "rejected" ? "approved" : undefined} />
          ))}
        </div>
      </section>

      <section aria-labelledby="sg-banners" className="stack">
        <h2 id="sg-banners">Banners</h2>
        <Banner kind="info">A new version is ready.</Banner>
        <Banner kind="warn">You're offline. Changes are saved on this device.</Banner>
        <Banner kind="danger">Update the app to keep syncing. Your data is safe.</Banner>
      </section>

      <section aria-labelledby="sg-states" className="stack">
        <h2 id="sg-states">States</h2>
        <div className="card">
          <LoadingState />
        </div>
        <div className="card">
          <EmptyState title="Nothing here yet">New items will show up here.</EmptyState>
        </div>
        <div className="card">
          <ErrorState onRetry={() => toast.show("Retrying…")} />
        </div>
        <div className="card">
          <ForbiddenState />
        </div>
      </section>

      <section aria-labelledby="sg-overlays" className="stack">
        <h2 id="sg-overlays">Toasts and dialogs</h2>
        <div className="row">
          <Button variant="secondary" onClick={() => toast.show("Saved on this device", "success")}>
            Show toast
          </Button>
          <Button variant="destructive" onClick={() => setConfirming(true)}>
            Delete submission…
          </Button>
        </div>
        <ConfirmDialog
          open={confirming}
          title="Delete this submission?"
          message="An admin can restore it later."
          confirmLabel="Delete"
          destructive
          onConfirm={() => setConfirming(false)}
          onCancel={() => setConfirming(false)}
        />
      </section>
    </div>
  );
}
