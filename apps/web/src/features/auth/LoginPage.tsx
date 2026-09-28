import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../../api/client";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await login(email, password);
      nav("/");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ maxWidth: 360 }}>
      <h2>Anmeldung</h2>
      <form onSubmit={submit} style={{ display: "grid", gap: "var(--space-3)" }}>
        <input
          type="email"
          placeholder="E-Mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="username"
        />
        <input
          type="password"
          placeholder="Passwort"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={12}
          autoComplete="current-password"
        />
        <button type="submit" disabled={busy}>
          {busy ? "Anmelden…" : "Anmelden"}
        </button>
        {err && (
          <p style={{ color: "var(--color-danger)", margin: 0, fontSize: "var(--text-sm)" }}>
            {err}
          </p>
        )}
      </form>
    </section>
  );
}
