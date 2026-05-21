import { useState, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, isLoggedIn } from "../../api/client";
import { LoginRequired } from "../../components/LoginRequired";

type Coach = { id: string; name: string };

type Lesson = { duration_slots: number; group_size: number };
type Mate = { player_id: string; mandatory: boolean };
type Category = "kids" | "youth" | "adults" | "team";

const CATEGORY_LABEL: Record<Category, string> = {
  kids: "Kinder",
  youth: "Jugend",
  adults: "Erwachsene",
  team: "Mannschaft",
};

type PlayerFull = {
  id: string;
  name: string;
  availability: number[];
  min_slots_per_week: number;
  max_slots_per_week: number;
  lessons?: Lesson[];
  mates?: Mate[];
  category?: Category;
  categories?: Category[];
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

  const setLessons = useMutation({
    mutationFn: ({ id, lessons }: { id: string; lessons: Lesson[] }) =>
      api(`/players/${id}/lessons`, {
        method: "PUT",
        body: JSON.stringify({ lessons }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["players-full"] }),
  });

  const setMates = useMutation({
    mutationFn: ({ id, mates }: { id: string; mates: Mate[] }) =>
      api(`/players/${id}/mates`, {
        method: "PUT",
        body: JSON.stringify({ mates }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["players-full"] }),
  });

  const setCategory = useMutation({
    mutationFn: ({ id, categories }: { id: string; categories: Category[] }) =>
      api(`/players/${id}/categories`, {
        method: "PATCH",
        body: JSON.stringify({ categories }),
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
              <th>Kategorie</th>
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
                      {canEditLevel ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {(Object.keys(CATEGORY_LABEL) as Category[]).map((cat) => {
                            const cur = p.categories ?? [];
                            const on = cur.includes(cat);
                            return (
                              <button
                                key={cat}
                                type="button"
                                onClick={() => {
                                  const next = on
                                    ? cur.filter((c) => c !== cat)
                                    : [...cur, cat];
                                  setCategory.mutate({ id: p.id, categories: next });
                                }}
                                style={{
                                  padding: "2px 6px",
                                  fontSize: 11,
                                  border: "1px solid #aaa",
                                  borderRadius: 3,
                                  background: on ? "#1976d2" : "#fff",
                                  color: on ? "#fff" : "#333",
                                  cursor: "pointer",
                                }}
                              >
                                {CATEGORY_LABEL[cat]}
                              </button>
                            );
                          })}
                        </div>
                      ) : (p.categories && p.categories.length > 0) ? (
                        p.categories.map((c) => CATEGORY_LABEL[c]).join(", ")
                      ) : (
                        "frei"
                      )}
                    </td>
                    <td>
                      {p.min_slots_per_week}–{p.max_slots_per_week}
                      {p.lessons && p.lessons.length > 0 && (
                        <div className="muted" style={{ fontSize: "var(--text-xs)" }}>
                          {p.lessons
                            .map((l) => `${l.duration_slots * 30}min ${groupLabel(l.group_size)}`)
                            .join(" + ")}
                        </div>
                      )}
                    </td><td>{p.availability.length}</td>
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
                      <td colSpan={7} style={{ background: "var(--color-bg-soft, #fafafa)" }}>
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
                        <LessonsEditor
                          lessons={p.lessons ?? []}
                          saving={setLessons.isPending}
                          onSave={(lessons) => setLessons.mutate({ id: p.id, lessons })}
                        />
                        <MatesEditor
                          mates={p.mates ?? []}
                          allPlayers={list}
                          self={p}
                          saving={setMates.isPending}
                          onSave={(mates) => setMates.mutate({ id: p.id, mates })}
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

function groupLabel(size: number): string {
  if (size === 1) return "Einzel";
  if (size === 2) return "Doppel";
  return `${size}er-Gruppe`;
}

function LessonsEditor({
  lessons,
  saving,
  onSave,
}: {
  lessons: Lesson[];
  saving: boolean;
  onSave: (lessons: Lesson[]) => void;
}) {
  const [draft, setDraft] = useState<Lesson[]>(lessons);

  function update(i: number, patch: Partial<Lesson>) {
    setDraft(draft.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function add() {
    setDraft([...draft, { duration_slots: 2, group_size: 1 }]);
  }
  function remove(i: number) {
    setDraft(draft.filter((_, idx) => idx !== i));
  }

  const total = draft.reduce((s, l) => s + l.duration_slots, 0);

  return (
    <div className="stack" style={{ padding: 12, borderTop: "1px solid var(--color-border, #e5e5e5)" }}>
      <strong>Trainings-Einheiten pro Woche</strong>
      <p className="muted" style={{ fontSize: "var(--text-xs)", margin: 0 }}>
        Welche Stunden soll dieser Spieler in welcher Gruppengröße bekommen?
        Der Solver versucht das einzuhalten und bestraft Abweichungen.
        Min-Stunden/Woche werden automatisch auf {total * 30} Minuten gesetzt.
      </p>
      {draft.length === 0 && (
        <span className="muted" style={{ fontSize: "var(--text-sm)" }}>
          (noch keine Einheiten – Solver nutzt dann nur min/max-Slots)
        </span>
      )}
      {draft.map((l, i) => (
        <div key={i} className="row" style={{ gap: 8, alignItems: "center" }}>
          <select
            value={l.duration_slots}
            onChange={(e) => update(i, { duration_slots: Number(e.target.value) })}
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n * 30} Min
              </option>
            ))}
          </select>
          <select
            value={l.group_size}
            onChange={(e) => update(i, { group_size: Number(e.target.value) })}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {groupLabel(n)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn--ghost"
            onClick={() => remove(i)}
            style={{ padding: "2px 8px", fontSize: "var(--text-sm)" }}
          >
            entfernen
          </button>
        </div>
      ))}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn--ghost" onClick={add}>
          + Einheit hinzufügen
        </button>
        <button onClick={() => onSave(draft)} disabled={saving}>
          {saving ? "Speichert…" : "Einheiten speichern"}
        </button>
      </div>
    </div>
  );
}

function MatesEditor({
  mates,
  allPlayers,
  self,
  saving,
  onSave,
}: {
  mates: Mate[];
  allPlayers: PlayerFull[];
  self: PlayerFull;
  saving: boolean;
  onSave: (mates: Mate[]) => void;
}) {
  const [draft, setDraft] = useState<Mate[]>(mates);

  function toggle(pid: string) {
    const existing = draft.find((m) => m.player_id === pid);
    if (existing) {
      setDraft(draft.filter((m) => m.player_id !== pid));
    } else {
      setDraft([...draft, { player_id: pid, mandatory: false }]);
    }
  }
  function setMandatory(pid: string, mandatory: boolean) {
    setDraft(draft.map((m) => (m.player_id === pid ? { ...m, mandatory } : m)));
  }

  return (
    <div className="stack" style={{ padding: 12, borderTop: "1px solid var(--color-border, #e5e5e5)" }}>
      <strong>Wunschspieler (vom Trainer kuratiert)</strong>
      <p className="muted" style={{ fontSize: "var(--text-xs)", margin: 0 }}>
        Welche Spieler passen zu diesem Spieler? Aktiviere ✓ für passende
        Partner. Setze 🔒 wenn diese Partner *zwingend* zusammen trainieren
        sollen (hartes Constraint). Mate-Beziehungen werden automatisch
        symmetrisch gespiegelt.
      </p>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        {allPlayers
          .filter((q) => q.id !== self.id)
          .map((q) => {
            const m = draft.find((x) => x.player_id === q.id);
            const on = !!m;
            const must = !!m?.mandatory;
            return (
              <div
                key={q.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 6px",
                  border: "1px solid var(--color-border, #e5e5e5)",
                  borderRadius: 4,
                  background: on ? "var(--color-bg, #fff)" : "transparent",
                }}
              >
                <button
                  type="button"
                  className={on ? "" : "btn--ghost"}
                  onClick={() => toggle(q.id)}
                  style={{ padding: "2px 8px", fontSize: "var(--text-sm)" }}
                >
                  {on ? "✓ " : ""}
                  {q.name}
                </button>
                {on && (
                  <label
                    style={{
                      fontSize: "var(--text-xs)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 2,
                    }}
                    title="zwingend zusammen – hartes Constraint"
                  >
                    <input
                      type="checkbox"
                      checked={must}
                      onChange={(e) => setMandatory(q.id, e.target.checked)}
                    />
                    🔒 Pflicht
                  </label>
                )}
              </div>
            );
          })}
        {allPlayers.length <= 1 && (
          <span className="muted">(keine anderen Spieler)</span>
        )}
      </div>
      <div className="row">
        <button onClick={() => onSave(draft)} disabled={saving}>
          {saving ? "Speichert…" : "Mates speichern"}
        </button>
      </div>
    </div>
  );
}
