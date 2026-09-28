// Shared training-category list — must mirror TrainingCategory in
// apps/api/src/coach_api/domain/entities.py.

export type Category =
  | "adults"
  | "team"
  | "foerderkader"
  | "ballschule"
  | "u8"
  | "u9"
  | "u10"
  | "u12"
  | "u15"
  | "u18"
  | "open";

export const CATEGORY_LABEL: Record<Category, string> = {
  adults: "Erwachsene",
  team: "Mannschaft",
  foerderkader: "Förderkader",
  ballschule: "Ballschule",
  u8: "U8 (Zwerge)",
  u9: "U9",
  u10: "U10",
  u12: "U12",
  u15: "U15",
  u18: "U18",
  open: "frei (alle)",
};

// Same list without the "open" wildcard marker — used where a player picks
// their own categories (there's no "open" to select, only real categories).
export type PlayerCategory = Exclude<Category, "open">;

export const PLAYER_CATEGORY_LABEL: Record<PlayerCategory, string> = Object.fromEntries(
  Object.entries(CATEGORY_LABEL).filter(([k]) => k !== "open"),
) as Record<PlayerCategory, string>;

// "frei" (open) isn't a category you add to the list — it's the visual
// state of "nothing else is selected" (= wildcard). Clicking it clears any
// other selection; picking any real category automatically turns it off.
export function isCategoryActive(selected: Category[], c: Category): boolean {
  return c === "open" ? selected.length === 0 : selected.includes(c);
}

export function toggleCategory(selected: Category[], c: Category): Category[] {
  if (c === "open") return [];
  return selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c];
}
