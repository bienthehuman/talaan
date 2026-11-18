import { useState } from "react";
import { Link, Outlet } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { useOnline } from "../hooks/useOnline";
import { useSyncStatus } from "../sync/status";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { ReauthPrompt } from "./ReauthPrompt";
import { ThemeToggle } from "./ThemeToggle";

function formatLastSync(date: Date | null): string {
  return date ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "never";
}

export function RootLayout() {
  const { user, logout } = useAuth();
  const online = useOnline();
  const { pending, conflicts, lastSyncAt, state, syncNow, resume } = useSyncStatus();
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  function requestSignOut() {
    // Unsent changes need an explicit confirmation (docs/protocol.md section 8).
    if (pending > 0) setConfirmingSignOut(true);
    else logout();
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {!online && (
        <Banner kind="warn">
          You're offline. Changes are saved on this device and will sync when you're back online.
        </Banner>
      )}
      {user && state === "paused-auth" && <ReauthPrompt onSignedIn={resume} />}
      {state === "upgrade-required" && (
        <Banner kind="danger">
          This version of the app is too old to sync. Your changes are safe on this device. Reload
          to update.
        </Banner>
      )}
      <header className="app-header">
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" />
          Talaan
        </Link>
        <div className="header-meta">
          {user && (
            <span>
              {pending} pending · Last sync: {formatLastSync(lastSyncAt)}
            </span>
          )}
          {user && conflicts > 0 && (
            <Link to="/" className="needs-decision">
              {conflicts === 1 ? "1 needs your decision" : `${conflicts} need your decision`}
            </Link>
          )}
          <ThemeToggle />
          {user && (
            <>
              <Button variant="secondary" small onClick={syncNow} disabled={state === "syncing"}>
                {state === "syncing" ? "Syncing…" : "Sync now"}
              </Button>
              <span>{user.username}</span>
              <Button variant="secondary" small onClick={requestSignOut}>
                Sign out
              </Button>
            </>
          )}
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <ConfirmDialog
        open={confirmingSignOut}
        title="Sign out with unsent changes?"
        message={
          pending === 1
            ? "1 change is saved only on this device. Signing out will delete it."
            : `${pending} changes are saved only on this device. Signing out will delete them.`
        }
        confirmLabel="Sign out and delete"
        destructive
        onConfirm={() => {
          setConfirmingSignOut(false);
          logout();
        }}
        onCancel={() => setConfirmingSignOut(false)}
      />
    </>
  );
}
