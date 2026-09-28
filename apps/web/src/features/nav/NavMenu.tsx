import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { filterTiles } from "./tiles";
import { confirmNavigation } from "../../lib/unsavedChanges";

function GridIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor" aria-hidden>
      <rect x="0" y="0" width="6" height="6" rx="1.5" />
      <rect x="9" y="0" width="6" height="6" rx="1.5" />
      <rect x="0" y="9" width="6" height="6" rx="1.5" />
      <rect x="9" y="9" width="6" height="6" rx="1.5" />
    </svg>
  );
}

type ToggleProps = { open: boolean; setOpen: (v: boolean) => void };

/** Just the trigger button — stays inside the (blurrable) nav bar so it's
 * always visible/clickable, independent of whether the panel is open. */
export function NavMenuButton({ open, setOpen }: ToggleProps) {
  return (
    <button
      className="navmenu__trigger"
      onClick={() => setOpen(!open)}
      aria-label="Alle Bereiche"
      title="Alle Bereiche"
    >
      <GridIcon />
    </button>
  );
}

/** The overlay + floating tiles. Rendered outside the blurred page wrapper
 * (see AppShell in main.tsx) so the tiles themselves stay sharp while
 * everything behind them blurs. */
export function NavMenuPanel({ open, setOpen }: ToggleProps) {
  const [role, setRole] = useState<string | null>(() => sessionStorage.getItem("user_role"));

  useEffect(() => {
    const sync = () => setRole(sessionStorage.getItem("user_role"));
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const tiles = filterTiles(role);

  return (
    <div className="navmenu" onClick={() => setOpen(false)}>
      <div
        className="navmenu__panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label="Navigation"
      >
        <div className="navmenu__grid">
          {tiles.map((t) => (
            <Link
              key={t.to}
              to={t.to}
              className="navmenu__tile"
              onClick={(e) => {
                if (!confirmNavigation()) { e.preventDefault(); return; }
                setOpen(false);
              }}
            >
              <span className="navmenu__tile-icon">{t.icon}</span>
              <span className="navmenu__tile-title">{t.title}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
