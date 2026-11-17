import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { Button } from "../components/Button";
import { PasswordField, TextField } from "../components/TextField";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { messageFor } from "../lib/problem";

export function LoginPage() {
  useDocumentTitle("Sign in");
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      const from = (location.state as { from?: string } | null)?.from ?? "/";
      navigate(from, { replace: true });
    } catch (err) {
      setError(messageFor(err, "login"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h1>Sign in</h1>
      <p>You need to sign in once with a connection. After that the app works offline.</p>
      <form className="stack" onSubmit={onSubmit} noValidate aria-busy={busy}>
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        <TextField
          label="Username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <PasswordField
          label="Password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
