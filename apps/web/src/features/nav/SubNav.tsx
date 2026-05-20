import { NavLink } from "react-router-dom";

type Item = { to: string; label: string; end?: boolean };

const itemClass = ({ isActive }: { isActive: boolean }) =>
  "subnav__link" + (isActive ? " subnav__link--active" : "");

export function SubNav({ items }: { items: Item[] }) {
  return (
    <nav className="subnav">
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.end} className={itemClass}>
          {it.label}
        </NavLink>
      ))}
    </nav>
  );
}
