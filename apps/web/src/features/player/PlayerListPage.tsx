import { useState, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, isLoggedIn } from "../../api/client";
import { LoginRequired } from "../../components/LoginRequired";

type Coach = { id: string; name: string };

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
    notes?: string;
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
  const coaches = useQuery<Coach[]>({
    queryKey: ["coaches"],
    queryFn: () => api<Coach[]>("/coaches"),
    enabled: authed,
  });

  const [expanded, setExpanded] = useState<string | null>(null);

  const setLevel = useMutation({
    mutationFn: ({ id, lk }: { id: string; lk: number | null }) =>
      api(`/players/${id}/level`, {
        method: "PATCH",
        body: JSON.stringify({ level_lk: lk }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["players-full"] }),
  });

  const setPrefs = useMutation({
    mutationFn: ({
      id,
      preferred_coach_ids,
      preferred_partner_ids,
    }: {
      id: string;
      preferred_coach_ids: string[];
      preferred_partner_ids: string[];
    }) =>
      api(`/players/${id}/preferences`, {
        method: "PATCH",
        body: JSON.stringify({ preferred_coach_ids, preferred_partner_ids }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["players-full"] }),
  });

  const canEditLevel = me.data?.role === "coach" || me.data?.role === "admin";
  const canEditPrefs = canEditLevel;

  if (!authed) return <LoginRequired />;
  if (players.isLoading) return <p>Lädt…</p>;

  const list = players.data ?? [];

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
              {canEditPrefs && <th>Wünsche &amp; Notizen</th>}
            </tr>
          </thead>
          <tbody>
            {list.map((p) => {
              const open = expanded === p.id;
              const coachCount = p.preferences.preferred_coach_ids?.length ?? 0;
              const partnerCount =
                p.preferences.preferred_partner_ids?.length ?? 0;
              const hasNotes = !!(p.preferences.notes ?? "").trim();
              return (
                <Fragment key={p.id}>
                  <tr>
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
                            const v =
                              e.target.value === ""
                                ? null
                                : Number(e.target.value);
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
                    {canEditPrefs && (
                      <td>
                        <button
                          type="button"
                          className="btn--ghost"
                          style={{ padding: "2px 10px", fontSize: "var(--text-sm)" }}
                          onClick={() => setExpanded(open ? null : p.id)}
                        >
                          {open ? "Zuklappen" : "Bearbeiten"}
                          {" · "}
                          {coachCount}T / {partnerCount}M
                          {hasNotes ? " · 📝" : ""}
                        </button>
                      </td>
                    )}
                  </tr>
                  {canEditPrefs && open && (
                    <tr key={p.id + "-edit"}>
                      <td colSpan={6} style={{ background: "var(--color-bg-soft, #fafafa)" }}>
                        <PrefsEditor
                          player={p}
                          coaches={coaches.data ?? []}
                          allPlayers={list}
                          saving={setPrefs.isPending}
                          onSave={(coachIds, partnerIds) =>
                            setPrefs.mutate({
                              id: p.id,
                              preferred_coach_ids: coachIds,
                              preferred_partner_ids: partnerIds,
                            })
                          }
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 && (
          <p className="muted">Noch keine Spieler angelegt.</p>
        )}
        {canEditPrefs && (
          <p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: 8 }}>
            <strong>T</strong> = Wunschtrainer, <strong>M</strong> = Wunsch-Mitspieler.
            Spieler selbst sehen und ändern diese Felder nicht; sie können
            stattdessen über ihr Profil eine freie Bemerkung schreiben (📝).
          </p>
        )}
      </div>
    </section>
  );
}

function PrefsEditor({
  player,
  coaches,
  allPlayers,
  saving,
  onSave,
}: {
  player: PlayerFull;
  coaches: Coach[];
  allPlayers: PlayerFull[];
  saving: boolean;
  onSave: (coachIds: string[], partnerIds: string[]) => void;
}) {
  const [coachIds, setCoachIds] = useState<string[]>(
    player.preferences.preferred_coach_ids ?? []
  );
  const [partnerIds, setPartnerIds] = useState<string[]>(
    player.preferences.preferred_partner_ids ?? []
  );
  const notes = (player.preferences.notes ?? "").trim();

  function toggle(list: string[], setList: (v: string[]) => void, id: string) {
    if (list.includes(id)) setList(list.filter((x) => x !== id));
    else setList([...list, id]);
  }

  return (
    <div className="stack" style={{ padding: 12 }}>
      <div>
        <strong>Wunschtrainer</strong>
        <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {coaches.length === 0 && <span className="muted">(keine Trainer)</span>}
          {coaches.map((c) => {
            const on = coachIds.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(coachIds, setCoachIds, c.id)}
                className={on ? "" : "btn--ghost"}
                style={{ padding: "4px 10px", fontSize: "var(--text-sm)" }}
              >
                {on ? "✓ " : ""}
                {c.name}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <strong>Wunsch-Mitspieler</strong>
        <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {allPlayers.filter((q) => q.id !== player.id).length === 0 && (
            <span className="muted">(keine anderen Spieler)</span>
          )}
          {allPlayers
            .filter((q) => q.id !== player.id)
            .map((q) => {
              const on = partnerIds.includes(q.id);
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => toggle(partnerIds, setPartnerIds, q.id)}
                  className={on ? "" : "btn--ghost"}
                  style={{ padding: "4px 10px", fontSize: "var(--text-sm)" }}
                >
                  {on ? "✓ " : ""}
                  {q.name}
                </button>
              );
            })}
        </div>
      </div>

      <div>
        <strong>Bemerkung des Spielers</strong>
        {notes ? (
          <pre
            style={{
              whiteSpace: "pre-wrap",
              fontFamily: "inherit",
              fontSize: "var(--text-sm)",
              background: "white",
              padding: 8,
              border: "1px solid var(--color-border, #e5e5e5)",
              borderRadius: 4,
              marginTop: 6,
            }}
          >
            {notes}
          </pre>
        ) : (
          <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
            (keine Bemerkung)
          </p>
        )}
      </div>

      <div className="row">
        <button onClick={() => onSave(coachIds, partnerIds)} disabled={saving}>
          {saving ? "Speichert…" : "Wünsche speichern"}
        </button>
      </div>
    </div>
  );
}
