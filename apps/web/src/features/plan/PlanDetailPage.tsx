import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import { api, isLoggedIn } from "../../api/client";
import { PlanCalendar } from "./PlanCalendar";
import { LoginRequired, isAuthError } from "../../components/LoginRequired";

type Session = {
  coach_id: string;
  court_id: string;
  player_ids: string[];
  slot_indices: number[];
  session_type: string;
};

type Plan = {
  id: string;
  season_id: string;
  score: number;
  explanation: string;
  sessions: Session[];
};

type Named = { id: string; name: string };

export function PlanDetailPage() {
  const { planId } = useParams<{ planId: string }>();
  const authed = isLoggedIn();

  const plan = useQuery({
    queryKey: ["plan", planId],
    queryFn: () => api<Plan>(`/plans/${planId}`),
    enabled: !!planId && authed,
  });
  const coaches = useQuery({ queryKey: ["coaches"], queryFn: () => api<Named[]>("/coaches"), enabled: authed });
  const players = useQuery({ queryKey: ["players"], queryFn: () => api<Named[]>("/players"), enabled: authed });
  const courts = useQuery({ queryKey: ["courts"], queryFn: () => api<Named[]>("/courts"), enabled: authed });

  const coachMap = Object.fromEntries((coaches.data ?? []).map((c) => [c.id, c.name]));
  const playerMap = Object.fromEntries((players.data ?? []).map((p) => [p.id, p.name]));
  const courtMap = Object.fromEntries((courts.data ?? []).map((c) => [c.id, c.name]));

  return (
    <section>
      <p><Link to="/">← zurück</Link></p>
      <h2>Plan {planId?.slice(0, 8)}</h2>
      {!authed && <LoginRequired />}
      {plan.isLoading && <p>lade...</p>}
      {plan.error && (isAuthError(plan.error) ? <LoginRequired /> : <p style={{ color: "crimson" }}>Fehler beim Laden.</p>)}
      {plan.data && (
        <>
          <p>
            Score: <strong>{plan.data.score.toFixed(1)}</strong> ·
            Sessions: {plan.data.sessions.length}
          </p>
          <PlanCalendar
            sessions={plan.data.sessions}
            coachNames={coachMap}
            playerNames={playerMap}
            courtNames={courtMap}
          />
        </>
      )}
    </section>
  );
}
