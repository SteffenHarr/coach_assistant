import { NavLink } from "react-router-dom";
import { confirmNavigation } from "../../lib/unsavedChanges";

type Item = { to: string; label: string; end?: boolean };

const itemClass = ({ isActive }: { isActive: boolean }) =>
  "subnav__link" + (isActive ? " subnav__link--active" : "");

export function SubNav({ items }: { items: Item[] }) {
  return (
    <nav className="subnav">
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          end={it.end}
          className={itemClass}
          onClick={(e) => { if (!confirmNavigation()) e.preventDefault(); }}
        >
          {it.label}
        </NavLink>
      ))}
    </nav>
  );
}
