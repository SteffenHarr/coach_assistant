import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, isLoggedIn } from "../../api/client";
import { LoginRequired } from "../../components/LoginRequired";

type PlayerFull = {
  id: string;
  name: string;
  availability: number[];
  min_slots_per_week: number;
  max_slots_per_week: number;
  preferences: {
    age?: number | null;
    level_lk?: number | null;
    preferred_coach_ids?: string[];
    preferred_partner_ids?: string[];
  };
};

export function PlayerListPage() {
  const qc = useQueryClient();
  const authed = isLoggedIn();
  const me = useQuery<{ role: string }>({
    queryKey: ["me"],
    queryFn: () => api<{ role: string }>("/me"),
    enabled: authed,
  });
  const players = useQuery<PlayerFull[]>({
    queryKey: ["players-full"],
    queryFn: () => api<PlayerFull[]>("/players/full"),
    enabled: authed,
  });

  const setLevel = useMutation({
    mutationFn: ({ id, lk }: { id: string; lk: number | null }) =>
      api(`/players/${id}/level`, {
        method: "PATCH",
        body: JSON.stringify({ level_lk: lk }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["players-full"] }),
  });

  const canEditLevel = me.data?.role === "coach" || me.data?.role === "admin";

  if (!authed) return <LoginRequired />;
  if (players.isLoading) return <p>Lädt…</p>;

  return (
    <section className="stack">
      <h2>Spieler</h2>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Alter</th>
              <th>Spielstärke (LK)</th>
              <th>Stunden/Woche</th>
              <th>Verfügbare Slots</th>
            </tr>
          </thead>
          <tbody>
            {(players.data ?? []).map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.preferences.age ?? "—"}</td>
                <td>
                  {canEditLevel ? (
                    <input
                      type="number"
                      min={1}
                      max={25}
                      defaultValue={p.preferences.level_lk ?? ""}
                      placeholder="—"
                      style={{ width: 70 }}
                      onBlur={(e) => {
                        const v = e.target.value === "" ? null : Number(e.target.value);
                        if (v !== (p.preferences.level_lk ?? null))
                          setLevel.mutate({ id: p.id, lk: v });
                      }}
                    />
                  ) : p.preferences.level_lk != null ? (
                    `LK ${p.preferences.level_lk}`
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {p.min_slots_per_week}–{p.max_slots_per_week}
                </td>
                <td>{p.availability.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(players.data ?? []).length === 0 && (
          <p className="muted">Noch keine Spieler angelegt.</p>
        )}
      </div>
    </section>
  );
}
