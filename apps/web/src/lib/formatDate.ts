/** Formats an ISO date string ("YYYY-MM-DD" or full ISO timestamp) as
 * "TT/MM/JJJJ" — the app always uses this German day-first order, never
 * the American month-first format. */
export function formatDateDE(iso: string | null | undefined): string {
  if (!iso) return "";
  const datePart = iso.slice(0, 10);
  const [y, m, d] = datePart.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
