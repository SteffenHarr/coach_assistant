// Centralised "please log in" placeholder. Used by every page that
// needs an authenticated session so the wording AND the visual look
// stay consistent across the whole app.

import { Link } from "react-router-dom";

export function LoginRequired({
  message = "Bitte melde dich an, um diese Seite zu sehen.",
}: { message?: string }) {
  return (
    <div
      className="login-required"
      style={{
        margin: "1.5rem 0",
        padding: "1rem 1.25rem",
        border: "1px solid var(--color-border, #d0d7de)",
        borderRadius: 8,
        background: "var(--color-surface, #f6f8fa)",
        color: "var(--color-text, #1f2328)",
      }}
    >
      <p style={{ margin: 0 }}>
        {message}{" "}
        <Link to="/login" style={{ fontWeight: 600 }}>
          Zum Login →
        </Link>
      </p>
    </div>
  );
}

/** True if the given error came from an unauthenticated API call. */
export function isAuthError(err: unknown): boolean {
  if (!err) return false;
  const status = (err as { status?: number }).status;
  if (status === 401 || status === 403) return true;
  const msg = (err as Error).message ?? "";
  return /401|403|nicht angemeldet|keine berechtigung/i.test(msg);
}
