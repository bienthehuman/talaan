import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthContext";
import {
  acceptInvite,
  checkInvite,
  LINK_PROBLEMS,
  tokenFromHash,
  type InviteInfo,
} from "../auth/invite";
import { Button, buttonClass } from "../components/Button";
import { ErrorState, LoadingState } from "../components/States";
import { PasswordField } from "../components/TextField";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { ApiError, fieldErrors, messageFor } from "../lib/problem";
import { formatFull } from "../lib/when";
import styles from "./InvitePage.module.css";

type State =
  | { kind: "checking" }
  | { kind: "ready"; invite: InviteInfo }
  | { kind: "unusable"; code: string }
  | { kind: "offline"; message: string };

const RULES =
  "At least 8 characters. Not only digits, not a common password, and not too close to your name.";

/** Where an invited worker sets their password (ADR 0014). Online only: the link is checked with
 *  the server, the user is created, and then they are signed in like anyone else. */
export function InvitePage() {
  useDocumentTitle("Set your password");
  const { user, login } = useAuth();
  const navigate = useNavigate();
  // Read once: the fragment is removed from the address bar below, so it is not left in the
  // history or shown over someone's shoulder.
  const { hash } = useLocation();
  const [token] = useState(() => tokenFromHash(hash));
  const [state, setState] = useState<State>(() =>
    token ? { kind: "checking" } : { kind: "unusable", code: "invite_not_found" },
  );
  const [attempt, setAttempt] = useState(0);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [errors, setErrors] = useState<{ password?: string[]; repeat?: string }>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Someone signed in here keeps the link in the address bar, so it still works after they
    // sign out (signing out is theirs to choose: it removes unsent work from this device).
    if (user || !token) return;
    if (hash) void navigate({ hash: "" }, { replace: true });
    let live = true;
    checkInvite(token).then(
      (invite) => live && setState({ kind: "ready", invite }),
      (err) => {
        if (!live) return;
        if (err instanceof ApiError && LINK_PROBLEMS[err.problem.code]) {
          setState({ kind: "unusable", code: err.problem.code });
        } else {
          setState({ kind: "offline", message: messageFor(err) });
        }
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `hash` is read once, then removed
  }, [user, token, attempt]);

  if (user) {
    return (
      <div className={`page stack ${styles.invite}`}>
        <h1>You're already signed in</h1>
        <p>
          This device is signed in as <strong>{user.username}</strong>. To join with this invite,
          sign out first from the account menu, then open the link again.
        </p>
        <p>
          <Link to="/" className={buttonClass("secondary")}>
            Back to the app
          </Link>
        </p>
      </div>
    );
  }

  async function submit(event: FormEvent, invite: InviteInfo) {
    event.preventDefault();
    setProblem(null);
    if (!password) {
      setErrors({ password: ["Choose a password."] });
      return;
    }
    if (password !== repeat) {
      setErrors({ repeat: "The two passwords are not the same." });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await acceptInvite(token, password);
    } catch (err) {
      setBusy(false);
      const fields = fieldErrors(err);
      if (fields?.password) setErrors({ password: fields.password });
      else if (err instanceof ApiError && LINK_PROBLEMS[err.problem.code]) {
        setState({ kind: "unusable", code: err.problem.code });
      } else if (err instanceof ApiError && err.problem.code === "username_taken") {
        setProblem(
          `Someone already uses the username ${invite.username}. Ask your admin to invite you again with another one.`,
        );
      } else setProblem(messageFor(err));
      return;
    }
    try {
      await login(invite.username, password);
      navigate("/", { replace: true });
    } catch {
      // The account exists; only the automatic sign-in failed.
      navigate("/login", { replace: true });
    }
  }

  return (
    <div className={`page stack ${styles.invite}`}>
      {state.kind === "checking" && <LoadingState label="Checking your invite…" />}

      {state.kind === "offline" && (
        <ErrorState onRetry={() => setAttempt((n) => n + 1)}>{state.message}</ErrorState>
      )}

      {state.kind === "unusable" && (
        <>
          <h1>This link can't be used</h1>
          <div className="alert" role="alert">
            {LINK_PROBLEMS[state.code]}
          </div>
          {state.code === "invite_used" && (
            <p>
              <Link to="/login" className={buttonClass("primary")}>
                Sign in
              </Link>
            </p>
          )}
        </>
      )}

      {state.kind === "ready" && (
        <form
          className={`card stack ${styles.form}`}
          onSubmit={(e) => void submit(e, state.invite)}
          noValidate
          aria-busy={busy}
          aria-labelledby="invite-heading"
        >
          <h1 id="invite-heading">
            {state.invite.first_name ? `Welcome, ${state.invite.first_name}` : "Welcome"}
          </h1>
          <p>
            Choose a password for your account. You sign in with the username{" "}
            <strong>{state.invite.username}</strong>.
          </p>
          {problem && (
            <div className="alert" role="alert">
              {problem}
            </div>
          )}
          {/* Lets a password manager save the username with the new password. */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={state.invite.username}
            readOnly
            hidden
          />
          <PasswordField
            label="New password"
            name="new-password"
            autoComplete="new-password"
            hint={RULES}
            error={errors.password?.join(" ")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <PasswordField
            label="Repeat the password"
            name="repeat-password"
            autoComplete="new-password"
            error={errors.repeat}
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
          <Button type="submit" disabled={busy} className={styles.submit}>
            {busy ? "Setting up…" : "Set password and sign in"}
          </Button>
          <p className={styles.note}>
            This link works once, until {formatFull(state.invite.expires_at)}.
          </p>
        </form>
      )}
    </div>
  );
}
