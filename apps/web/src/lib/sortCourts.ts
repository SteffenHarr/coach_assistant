// Shared court ordering: indoor courts first, then outdoor — and within each
// group, "natural" numeric order (Platz 2 before Platz 10), not lexicographic.

function compareCourtNames(a: string, b: string): number {
  const ma = a.match(/^(.*?)(\d+)\D*$/);
  const mb = b.match(/^(.*?)(\d+)\D*$/);
  if (ma && mb) {
    const prefixCmp = ma[1].localeCompare(mb[1], "de");
    if (prefixCmp !== 0) return prefixCmp;
    return Number(ma[2]) - Number(mb[2]);
  }
  return a.localeCompare(b, "de");
}

export function sortCourts<T extends { name: string; indoor: boolean }>(courts: T[]): T[] {
  return [...courts].sort((a, b) => {
    if (a.indoor !== b.indoor) return a.indoor ? -1 : 1;
    return compareCourtNames(a.name, b.name);
  });
}
