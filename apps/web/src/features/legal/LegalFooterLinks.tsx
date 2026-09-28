import { Link } from "react-router-dom";

/**
 * Small, unobtrusive footer links — this is where Impressum/Datenschutz
 * ultimately belong (visible to everyone, even logged out). Admin-only
 * gate lives in main.tsx's routes; this component itself doesn't check
 * the role, so once that gate is removed these links can also be shown
 * to logged-out visitors from here without further changes.
 */
export function LegalFooterLinks() {
  return (
    <div style={{ display: "flex", gap: "var(--space-4)", fontSize: "var(--text-xs)" }}>
      <Link to="/impressum" className="muted" style={{ textDecoration: "none" }}>Impressum</Link>
      <Link to="/datenschutz" className="muted" style={{ textDecoration: "none" }}>Datenschutz</Link>
    </div>
  );
}
