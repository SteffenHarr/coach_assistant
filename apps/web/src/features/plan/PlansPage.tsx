import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../api/client";

type Season = { id: string; name: string; valid_from: string; valid_to: string };
type Plan = { id: string; season_id: string; score: number; sessions: any[] };

export function PlansPage() {
  const seasons = useQuery({
    queryKey: ["seasons"],
    queryFn: () => api<Season[]>("/seasons"),
  });

  return (
    <section>
      <h2>Trainingspläne</h2>
      {seasons.isLoading && <p>lade...</p>}
      {seasons.error && <p>Bitte einloggen.</p>}
      {seasons.data && seasons.data.length === 0 && (
        <p>Noch keine Saison angelegt.</p>
      )}
      <ul>
        {seasons.data?.map((s) => (
          <li key={s.id} style={{ marginBottom: 12 }}>
            <strong>{s.name}</strong> ({s.valid_from} – {s.valid_to})
            <SeasonPlans seasonId={s.id} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SeasonPlans({ seasonId }: { seasonId: string }) {
  const q = useQuery({
    queryKey: ["plans", seasonId],
    queryFn: () => api<Plan[]>(`/seasons/${seasonId}/plans`),
  });
  if (!q.data) return null;
  return (
    <ul>
      {q.data.map((p) => (
        <li key={p.id}>
          <Link to={`/plans/${p.id}`}>
            Plan {p.id.slice(0, 8)} – Score {p.score.toFixed(1)} – {p.sessions.length} Sessions
          </Link>
        </li>
      ))}
    </ul>
  );
}
