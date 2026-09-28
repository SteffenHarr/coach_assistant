import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

type Me = { id: string; email: string; role: string };

export function AccountSettingsPage() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });

  const [email, setEmail] = useState("");
  useEffect(() => {
    if (me.data) setEmail(me.data.email);
  }, [me.data]);

  const saveEmail = useMutation({
    mutationFn: () => api("/users/me", { method: "PATCH", body: JSON.stringify({ email }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });

  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const pwMismatch = pw1.length > 0 && pw2.length > 0 && pw1 !== pw2;
  const pwValid = pw1.length >= 12 && pw1 === pw2;

  const savePassword = useMutation({
    mutationFn: () => api("/users/me", { method: "PATCH", body: JSON.stringify({ password: pw1 }) }),
    onSuccess: () => {
      setPw1("");
      setPw2("");
    },
  });

  return (
    <section>
      <h2>Mein Konto</h2>
      {me.isLoading && <p>lade...</p>}
      {me.error && (
        <p style={{ color: "var(--color-danger)" }}>{(me.error as Error).message}</p>
      )}

      {me.data && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", maxWidth: 420 }}>
          <div className="card">
            <h3 className="card__title">E-Mail-Adresse</h3>
            <div className="stack">
              <label>
                E-Mail
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </label>
              <div className="row">
                <button
                  onClick={() => saveEmail.mutate()}
                  disabled={!email || email === me.data.email || saveEmail.isPending}
                >
                  {saveEmail.isPending ? "speichere..." : "E-Mail speichern"}
                </button>
                {saveEmail.isSuccess && <span className="pill pill--success">Gespeichert</span>}
                {saveEmail.error && (
                  <span style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)" }}>
                    {(saveEmail.error as Error).message}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="card__title">Passwort ändern</h3>
            <div className="stack">
              <label>
                Neues Passwort (mind. 12 Zeichen)
                <input
                  type="password"
                  value={pw1}
                  onChange={(e) => setPw1(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <label>
                Neues Passwort bestätigen
                <input
                  type="password"
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
              {pwMismatch && (
                <p style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)", margin: 0 }}>
                  Passwörter stimmen nicht überein.
                </p>
              )}
              <div className="row">
                <button onClick={() => savePassword.mutate()} disabled={!pwValid || savePassword.isPending}>
                  {savePassword.isPending ? "speichere..." : "Passwort ändern"}
                </button>
                {savePassword.isSuccess && <span className="pill pill--success">Passwort geändert</span>}
                {savePassword.error && (
                  <span style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)" }}>
                    {(savePassword.error as Error).message}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
