// Shared time-grid constants — must mirror apps/api/src/coach_api/domain/time_grid.py
// (slot_minutes=30, day_start=07:00, day_end=22:00).
export const SLOT_MINUTES = 30;
export const DAY_START_MIN = 7 * 60;
export const DAY_END_MIN = 22 * 60;
export const SLOTS_PER_DAY = (DAY_END_MIN - DAY_START_MIN) / SLOT_MINUTES; // 30
export const TOTAL_SLOTS = SLOTS_PER_DAY * 7;

export const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;

export function slotLabel(localIdx: number): string {
  const minutes = DAY_START_MIN + localIdx * SLOT_MINUTES;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function slotIndex(day: number, localIdx: number): number {
  return day * SLOTS_PER_DAY + localIdx;
}
