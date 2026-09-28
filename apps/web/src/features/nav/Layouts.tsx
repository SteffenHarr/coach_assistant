import { Outlet } from "react-router-dom";
import { SubNav } from "../nav/SubNav";

function useRole(): string | null {
  return sessionStorage.getItem("user_role");
}

export function PlansLayout() {
  const role = useRole();
  // Season/plan generation & publishing is admin/planner-only on the backend
  // (coaches only ever see already-published plans) — no point showing a
  // coach a wizard step that will just 403.
  const items = [
    { to: "/plaene", label: "Übersicht", end: true },
    ...(role === "admin" || role === "planner"
      ? [
          { to: "/plaene/vergleich", label: "Vergleichen" },
          { to: "/plaene/saisonwechsel", label: "Saisonwechsel" },
        ]
      : []),
  ];
  return (
    <>
      <SubNav items={items} />
      <Outlet />
    </>
  );
}

export function CoachLayout() {
  const role = useRole();
  // Bulk-editing every coach's constraints is admin/planner-only on the
  // backend — a coach edits their own data via "Mein Profil" instead.
  const items = [
    { to: "/trainer", label: "Liste", end: true },
    { to: "/trainer/profil", label: "Mein Profil" },
    ...(role === "admin" || role === "planner" ? [{ to: "/trainer/bulk", label: "Daten bearbeiten" }] : []),
  ];
  return (
    <>
      <SubNav items={items} />
      <Outlet />
    </>
  );
}

export function PlayerLayout() {
  const role = useRole();
  // A plain player only ever sees themselves in the roster (one entry) and
  // cannot edit arbitrary players' mates — both are redundant with
  // "Mein Profil" for that role, so hide them.
  const isStaff = role === "admin" || role === "planner" || role === "coach";
  const items = [
    ...(isStaff ? [{ to: "/spieler", label: "Liste", end: true }] : []),
    { to: "/spieler/profil", label: "Mein Profil", end: !isStaff },
    ...(isStaff ? [{ to: "/spieler/daten", label: "Daten bearbeiten" }] : []),
  ];
  return (
    <>
      <SubNav items={items} />
      <Outlet />
    </>
  );
}
