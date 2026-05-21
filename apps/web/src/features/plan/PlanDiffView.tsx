import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api, isLoggedIn } from "../../api/client";
import { LoginRequired, isAuthError } from "../../components/LoginRequired";

type Session = {
  coach_id: string;
  court_id: string;
  player_ids: string[];
  slot_indices: number[];
  session_type: string;
};

type Diff = {
  added: Session[];
  removed: Session[];
  unchanged_count: number;
  workload: {
    coach_slots: Record<string, number>;
    player_slots: Record<string, number>;
  };
  score_delta: number;
};

export function PlanDiffView() {
  const [params] = useSearchParams();
  const [oldId, setOldId] = useState(params.get("old") ?? "");
  const [newId, setNewId] = useState(params.get("new") ?? "");
  const [run, setRun] = useState(0);

  const q = useQuery({
    queryKey: ["diff", oldId, newId, run],
    queryFn: () => api<Diff>(`/plans/${oldId}/diff/${newId}`),
    enabled: false,
  });

  useEffect(() => {
    if (params.get("old") && params.get("new")) {
      setRun((r) => r + 1);
      // refetch happens via key change + manual refetch below
      q.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section>
      <h2>Plan-Vergleich</h2>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr auto", marginBottom: 12 }}>
        <input placeholder="Alte Plan-ID" value={oldId} onChange={(e) => setOldId(e.target.value)} />
        <input placeholder="Neue Plan-ID" value={newId} onChange={(e) => setNewId(e.target.value)} />
        <button onClick={() => { setRun(run + 1); q.refetch(); }} disabled={!oldId || !newId}>
          Vergleichen
        </button>
      </div>

      {!isLoggedIn() && <LoginRequired />}
      {q.error && (isAuthError(q.error) ? <LoginRequired /> : <p style={{ color: "crimson" }}>Fehler: {(q.error as Error).message}</p>)}
      {q.data && (
        <div>
          <p>
            <strong>Score-Delta:</strong>{" "}
            <span style={{ color: q.data.score_delta >= 0 ? "#2e7d32" : "crimson" }}>
              {q.data.score_delta > 0 ? "+" : ""}{q.data.score_delta.toFixed(1)}
            </span>{" "}
            · unverändert: {q.data.unchanged_count}
          </p>

          <Section title={`Hinzugefügt (${q.data.added.length})`} sessions={q.data.added} color="#2e7d32" />
          <Section title={`Entfernt (${q.data.removed.length})`} sessions={q.data.removed} color="crimson" />

          <h3>Auslastungs-Veränderung</h3>
          <table style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr><th style={th}>Typ</th><th style={th}>ID</th><th style={th}>Δ Slots</th></tr>
            </thead>
            <tbody>
              {Object.entries(q.data.workload.coach_slots).map(([id, d]) => (
                <tr key={"c" + id}><td style={td}>Trainer</td><td style={td}>{id.slice(0, 8)}</td><td style={tdNum(d)}>{d > 0 ? "+" : ""}{d}</td></tr>
              ))}
              {Object.entries(q.data.workload.player_slots).map(([id, d]) => (
                <tr key={"p" + id}><td style={td}>Spieler</td><td style={td}>{id.slice(0, 8)}</td><td style={tdNum(d)}>{d > 0 ? "+" : ""}{d}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Section({ title, sessions, color }: { title: string; sessions: Session[]; color: string }) {
  if (!sessions.length) return null;
  return (
    <details open style={{ margin: "8px 0" }}>
      <summary style={{ color, fontWeight: 600 }}>{title}</summary>
      <ul>
        {sessions.map((s, i) => (
          <li key={i}>
            Slots {s.slot_indices[0]}–{s.slot_indices[s.slot_indices.length - 1]} ·
            {" "}{s.player_ids.length} Spieler · {s.session_type}
          </li>
        ))}
      </ul>
    </details>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "4px 8px", borderBottom: "1px solid #ccc" };
const td: React.CSSProperties = { padding: "4px 8px", borderBottom: "1px solid #eee" };
const tdNum = (d: number): React.CSSProperties => ({
  ...td,
  textAlign: "right",
  color: d >= 0 ? "#2e7d32" : "crimson",
});
