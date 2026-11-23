import { useState, type FormEvent } from "react";
import { useAuth, WrongUserError } from "../auth/AuthContext";
import { messageFor } from "../lib/problem";
import { Button } from "./Button";
import { PasswordField } from "./TextField";
import { bannerClass } from "./Banner";

/** Shown when the server no longer accepts the saved session. Nothing is lost: unsent changes stay
 *  on the device and sync once the person signs in again. */
export function ReauthPrompt({ onSignedIn }: { onSignedIn: () => void }) {
  const { user, reauthenticate } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await reauthenticate(password);
      setPassword("");
      onSignedIn();
    } catch (err) {
      setError(
        err instanceof WrongUserError ? `Sign in as ${user?.username}.` : messageFor(err, "login"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={bannerClass("warn")} onSubmit={submit} aria-busy={busy} noValidate>
      <p role="status">
        For your security, enter your password again to keep sending. Your work is safe on this
        device.
      </p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <PasswordField
        label="Password"
        name="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Button type="submit" small disabled={busy}>
        Sign in
      </Button>
    </form>
  );
}
