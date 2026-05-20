import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { SLOT_MINUTES } from "../../lib/timeGrid";

type CoachFull = {
  id: string;
  name: string;
  availability: number[];
  max_group_size: number;
  constraints: {
    min_block_slots?: number;
    max_slots_per_day?: number | null;
    max_slots_per_week?: number | null;
    min_break_slots?: number;
    accepts_lk_min?: number | null;
    accepts_lk_max?: number | null;
    accepts_age_min?: number | null;
    accepts_age_max?: number | null;
  };
};

function hoursOf(slots: number | null | undefined): string {
  if (slots == null) return "–";
  return ((slots * SLOT_MINUTES) / 60).toFixed(1).replace(/\.0$/, "") + " h";
}

function range(lo: number | null | undefined, hi: number | null | undefined, unit = ""): string {
  if (lo == null && hi == null) return "alle";
  if (lo == null) return `≤ ${hi}${unit}`;
  if (hi == null) return `≥ ${lo}${unit}`;
  if (lo === hi) return `${lo}${unit}`;
  return `${lo}–${hi}${unit}`;
}

export function CoachListPage() {
  const coaches = useQuery<CoachFull[]>({
    queryKey: ["coaches-full"],
    queryFn: () => api<CoachFull[]>("/coaches/full"),
  });

  if (coaches.isLoading) return <p>Lädt…</p>;
  if (coaches.error)
    return (
      <p style={{ color: "var(--color-danger)" }}>
        {(coaches.error as Error).message}
      </p>
    );

  return (
    <section className="stack">
      <h2>Trainer</h2>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Max. Gruppe</th>
              <th>Akzeptiert LK</th>
              <th>Akzeptiert Alter</th>
              <th>Max./Tag</th>
              <th>Max./Woche</th>
              <th>Verfügbare Stunden</th>
            </tr>
          </thead>
          <tbody>
            {(coaches.data ?? []).map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.max_group_size}</td>
                <td>{range(c.constraints.accepts_lk_min, c.constraints.accepts_lk_max, " LK")}</td>
                <td>{range(c.constraints.accepts_age_min, c.constraints.accepts_age_max, "")}</td>
                <td>{hoursOf(c.constraints.max_slots_per_day)}</td>
                <td>{hoursOf(c.constraints.max_slots_per_week)}</td>
                <td>{hoursOf(c.availability.length)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(coaches.data ?? []).length === 0 && (
          <p className="muted">Noch keine Trainer angelegt.</p>
        )}
        <p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: 8 }}>
          Neue Trainer werden über <b>Benutzer-Verwaltung → Neuen Benutzer anlegen</b> mit Rolle „Trainer" hinzugefügt.
          Trainer pflegen ihre Daten unter <b>Mein Profil</b>.
        </p>
      </div>
    </section>
  );
}
