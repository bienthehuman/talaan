import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { useOnline } from "../hooks/useOnline";
import { useSyncStatus } from "../sync/status";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { useStoragePersistence } from "../pwa/storage";
import { ConfirmDialog } from "./ConfirmDialog";
import { InstallPrompt } from "./InstallPrompt";
import { ReauthPrompt } from "./ReauthPrompt";
import styles from "./RootLayout.module.css";
import { AccountMenu } from "./AccountMenu";

function formatLastSync(date: Date | null): string {
  return date ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "never";
}

export function RootLayout() {
  const { user, logout } = useAuth();
  const online = useOnline();
  const { pending, conflicts, lastSyncAt, state, syncNow, resume } = useSyncStatus();
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  // Ask the browser to protect local data once this device has synced successfully.
  useStoragePersistence(user?.role === "worker" && lastSyncAt !== null);

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
      <header className={styles.band}>
        <div className={styles.bar}>
          <Link to="/" className={`${styles.brand} tap-link`}>
            <img src="/favicon.svg" alt="" />
            Talaan
          </Link>
          <AccountMenu user={user} onSignOut={requestSignOut} />
        </div>
        {user?.role === "worker" && (
          <div className={styles.sync}>
            <Link to="/sync" className={`${styles.status} tap-link`}>
              <span className={`${styles.numeral} ${pending > 0 ? styles.waiting : ""}`}>
                {pending}
              </span>{" "}
              pending · Last sync: {formatLastSync(lastSyncAt)}
            </Link>
            {conflicts > 0 && (
              <Link to="/" className={`${styles.needsDecision} tap-link`}>
                {conflicts === 1 ? "1 needs your decision" : `${conflicts} need your decision`}
              </Link>
            )}
            <Button
              className={styles.syncNow}
              onClick={syncNow}
              disabled={state === "syncing"}
              aria-busy={state === "syncing" || undefined}
            >
              {state === "syncing" ? "Syncing…" : "Sync now"}
            </Button>
          </div>
        )}
      </header>
      {!online && (
        <Banner kind="warn">
          You're offline. Changes are saved on this device and will sync when you're back online.
        </Banner>
      )}
      {user?.role === "worker" && <InstallPrompt />}
      {user?.role === "worker" && state === "paused-auth" && <ReauthPrompt onSignedIn={resume} />}
      {state === "upgrade-required" && (
        <Banner kind="danger">
          This version of the app is too old to sync. Your changes are safe on this device. Reload
          to update.
        </Banner>
      )}
      {user?.role === "admin" ? (
        <div className={styles.shell}>
          <nav aria-label="Admin" className={styles.rail}>
            <NavLink to="/manage/review">Review</NavLink>
            <NavLink to="/manage/forms">Forms</NavLink>
            <NavLink to="/manage/assignments">Assignments</NavLink>
            <NavLink to="/manage/conflicts">Conflict log</NavLink>
          </nav>
          <main id="main" tabIndex={-1} className={styles.main}>
            <Outlet />
          </main>
        </div>
      ) : (
        <main id="main" tabIndex={-1}>
          <Outlet />
        </main>
      )}
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
