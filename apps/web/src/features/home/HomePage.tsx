import { useState, useEffect } from "react";
import { filterTiles } from "../nav/tiles";
import { isLoggedIn, login, logout } from "../../api/client";
import { Link } from "react-router-dom";
import { LegalFooterLinks } from "../legal/LegalFooterLinks";

export function HomePage() {
  const [authed, setAuthed] = useState<boolean>(isLoggedIn);
  const [role, setRole] = useState<string | null>(() => sessionStorage.getItem("user_role"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sync = () => {
      setAuthed(isLoggedIn());
      setRole(sessionStorage.getItem("user_role"));
    };
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      // login() fragt Rolle + Datenschutz-Zustimmung bereits selbst als
      // Teil des Logins ab und legt beides in sessionStorage ab, bevor es
      // zurückkehrt — kein zweiter /me-Request hier nötig.
      await login(email, password);
      setRole(sessionStorage.getItem("user_role"));
      setAuthed(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function doLogout() {
    logout();
    setAuthed(false);
    setRole(null);
  }

  const tiles = filterTiles(authed ? role : null);

  return (
    <div className="home">
      {authed && (
        <div className="home__account-bar">
          <Link to="/konto" className="home__account-link">Mein Konto</Link>
          <button type="button" className="home__account-link" onClick={doLogout}>
            Abmelden
          </button>
        </div>
      )}
      <div className="home__hero">
        <div className="home__logo">
          <span className="home__logo-dot" aria-hidden />
          Coach Assistant
        </div>
        <p className="home__tagline">
          Intelligente Trainingsplanung für deinen Verein
        </p>
      </div>

      {!authed ? (
        <form className="home__login" onSubmit={submit}>
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
          <button type="submit" disabled={busy} className="home__cta" style={{ width: "100%" }}>
            {busy ? "Anmelden…" : "Anmelden"}
          </button>
          {err && <p className="home__login-err">{err}</p>}
        </form>
      ) : (
        <div className="home__grid">
          {tiles.map((t) => (
            <Link key={t.to} to={t.to} className="home__tile">
              <span className="home__tile-icon">{t.icon}</span>
              <h3 className="home__tile-title">{t.title}</h3>
              <p className="home__tile-desc">{t.desc}</p>
            </Link>
          ))}
        </div>
      )}

      {authed && (
        <p className="home__footer">Wähle einen Bereich</p>
      )}

      <div style={{ marginTop: authed ? "var(--space-4)" : "var(--space-6)" }}>
        <LegalFooterLinks />
      </div>
    </div>
  );
}
