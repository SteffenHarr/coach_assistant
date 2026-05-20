import { Outlet } from "react-router-dom";
import { SubNav } from "../nav/SubNav";

export function PlansLayout() {
  return (
    <>
      <SubNav
        items={[
          { to: "/plaene", label: "Übersicht", end: true },
          { to: "/plaene/vergleich", label: "Vergleichen" },
          { to: "/plaene/saisonwechsel", label: "Saisonwechsel" },
        ]}
      />
      <Outlet />
    </>
  );
}

export function CoachLayout() {
  return (
    <>
      <SubNav
        items={[
          { to: "/trainer", label: "Liste", end: true },
          { to: "/trainer/profil", label: "Mein Profil" },
        ]}
      />
      <Outlet />
    </>
  );
}

export function PlayerLayout() {
  return (
    <>
      <SubNav
        items={[
          { to: "/spieler", label: "Liste", end: true },
          { to: "/spieler/profil", label: "Mein Profil" },
        ]}
      />
      <Outlet />
    </>
  );
}
