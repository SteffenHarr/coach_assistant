export type Tile = {
  to: string;
  icon: string;
  title: string;
  desc: string;
  roles: Array<"all" | "admin" | "planner" | "coach">;
};

export const ALL_TILES: Tile[] = [
  { to: "/plaene",           icon: "📋", title: "Trainingspläne",  desc: "Optimierte Saisonpläne generieren, vergleichen und anpassen.",  roles: ["admin", "planner", "coach"] },
  { to: "/spieler",          icon: "🎾", title: "Spieler",          desc: "Profile, Gruppen und Trainingspräferenzen verwalten.",          roles: ["all"] },
  { to: "/trainer",          icon: "🎓", title: "Trainer",          desc: "Constraints, Verfügbarkeiten und Wochenstunden einstellen.",    roles: ["admin", "planner", "coach"] },
  { to: "/verfuegbarkeiten", icon: "🗓", title: "Verfügbarkeiten", desc: "Wochenraster für alle Trainer, Spieler und Plätze pflegen.",    roles: ["admin", "planner"] },
  { to: "/plaetze",          icon: "🏟", title: "Plätze",           desc: "Courts anlegen, bearbeiten und Verfügbarkeiten eintragen.",     roles: ["admin", "planner"] },
  { to: "/admin/users",      icon: "👥", title: "Benutzer",         desc: "Nutzerkonten und Rollen für den Verein verwalten.",             roles: ["admin"] },
];

export function filterTiles(role: string | null): Tile[] {
  return ALL_TILES.filter((t) => {
    if (t.roles.includes("all")) return true;
    if (!role) return false;
    return t.roles.includes(role as "admin" | "planner" | "coach");
  });
}
