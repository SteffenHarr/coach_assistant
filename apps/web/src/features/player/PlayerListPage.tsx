import { useState, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, isLoggedIn, downloadFile } from "../../api/client";
import { LoginRequired } from "../../components/LoginRequired";
import { type PlayerCategory as Cat, PLAYER_CATEGORY_LABEL as CAT_LABEL } from "../../lib/categories";

type Coach = { id: string; name: string };
type Mate   = { player_id: string; mandatory: boolean };
type SessionTypePref = "single" | "double" | "group";
const SESSION_TYPE_LABEL: Record<SessionTypePref, string> = {
  single: "Einzel",
  double: "Zweier",
  group: "Gruppentraining",
};

type PlayerFull = {
  id: string; name: string; availability: number[];
  min_slots_per_week: number; max_slots_per_week: number;
  mates?: Mate[]; categories?: Cat[];
  active?: boolean;
  preferences: {
    age?: number | null; level_lk?: number | null;
    preferred_coach_ids?: string[];
    notes?: string;
    allowed_session_types?: SessionTypePref[];
  };
};

type BulkClearField = "availability" | "mates" | "notes" | "hours";
const BULK_CLEAR_FIELD_LABEL: Record<BulkClearField, string> = {
  availability: "Verfügbarkeit",
  mates: "Mitspieler",
  notes: "Kommentar",
  hours: "Min/Max Stunden",
};

const SLOT = 30;
const fmtH = (slots: number) => (slots * SLOT / 60).toFixed(1);

function Chip({ label, active, onClick, disabled }: {
  label: string; active: boolean; onClick?: () => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      style={{
        padding: "3px 12px", fontSize: "var(--text-xs)",
        fontWeight: active ? 600 : 400,
        borderRadius: "var(--radius-pill)",
        // --color-toggle statt --color-primary: Primary ist im Rest der App
        // "Aktion ausführen" (Speichern, Anmelden) — für einen "aktiv/inaktiv"
        // Zustand wie hier verwechselt das leicht, ob Blau nun "ausgewählt"
        // oder "der Knopf zum Drücken" bedeutet. Zusätzlich ein Häkchen als
        // zweites, farbunabhängiges Signal.
        border: `1.5px solid ${active ? "var(--color-toggle)" : "var(--color-border-strong)"}`,
        background: active ? "var(--color-toggle)" : "var(--color-surface)",
        color: active ? "var(--color-toggle-fg)" : "var(--color-text-muted)",
        cursor: disabled ? "default" : "pointer",
        transition: "all 0.1s ease", flexShrink: 0,
      }}
    >
      {active ? "✓ " : ""}{label}
    </button>
  );
}

function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ marginBottom: "var(--space-2)" }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
        textTransform: "uppercase", color: "var(--color-text-soft)",
        paddingBottom: "var(--space-1)", borderBottom: "1px solid var(--color-border)",
      }}>
        {title}
      </div>
      {hint && <p className="muted" style={{ fontSize: "var(--text-xs)", margin: "4px 0 0" }}>{hint}</p>}
    </div>
  );
}

export function PlayerListPage() {
  const qc       = useQueryClient();
  const authed   = isLoggedIn();
  const meQ      = useQuery<{ role: string }>({ queryKey: ["me"],          queryFn: () => api<{ role: string }>("/me"),            enabled: authed });
  const playersQ = useQuery<PlayerFull[]>    ({ queryKey: ["players-full"], queryFn: () => api<PlayerFull[]>("/players/full"),      enabled: authed });
  const coachesQ = useQuery<Coach[]>         ({ queryKey: ["coaches"],      queryFn: () => api<Coach[]>("/coaches"),                enabled: authed });
  const [openId, setOpenId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const [availFilter, setAvailFilter] = useState<"all" | "with" | "without">("all");
  const [notesFilter, setNotesFilter] = useState<"all" | "with" | "without">("all");
  const [catFilter, setCatFilter] = useState<Cat | "all">("all");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const canEdit = ["coach", "admin", "planner"].includes(meQ.data?.role ?? "");
  // Exporting everyone's data for offline analysis is more sensitive than
  // the day-to-day roster edits above — restricted to planner/admin,
  // deliberately excluding coach.
  const canExport = ["admin", "planner"].includes(meQ.data?.role ?? "");
  // Bulk-Verfügbarkeit-Löschen ist ein besonders folgenschweres
  // Saisonwechsel-Werkzeug — bewusst nur für Admins sichtbar, nicht mal für
  // Planner/Trainer.
  const canBulkClear = meQ.data?.role === "admin";
  const [exportBusy, setExportBusy] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  async function runExport(path: string, filename: string) {
    setExportBusy(path);
    setExportError(null);
    try {
      await downloadFile(path, filename);
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExportBusy(null);
    }
  }

  const createPlayer = useMutation({
    mutationFn: () => api<PlayerFull>("/players/quick", { method: "POST", body: JSON.stringify({ name: newName.trim() }) }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["players-full"] });
      setOpenId(p.id);
      setNewName("");
    },
  });

  const mLevel  = useMutation({ mutationFn: ({ id, lk }: { id: string; lk: number | null }) =>
    api(`/players/${id}/level`, { method: "PATCH", body: JSON.stringify({ level_lk: lk }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["players-full"] }) });

  const mPrefs  = useMutation({ mutationFn: ({ id, cids }: { id: string; cids: string[] }) =>
    api(`/players/${id}/preferences`, { method: "PATCH", body: JSON.stringify({ preferred_coach_ids: cids }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["players-full"] }) });

  const mCat    = useMutation({ mutationFn: ({ id, cats }: { id: string; cats: Cat[] }) =>
    api(`/players/${id}/categories`, { method: "PATCH", body: JSON.stringify({ categories: cats }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["players-full"] }) });

  const mSessionTypes = useMutation({
    mutationFn: ({ id, types }: { id: string; types: SessionTypePref[] }) =>
      api(`/players/${id}/session-types`, { method: "PATCH", body: JSON.stringify({ allowed_session_types: types }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["players-full"] }),
  });

  const mMates  = useMutation({ mutationFn: ({ id, mates }: { id: string; mates: Mate[] }) =>
    api(`/players/${id}/mates`, { method: "PUT", body: JSON.stringify({ mates }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["players-full"] }) });

  // Pausieren statt löschen: alle Daten bleiben erhalten, der Solver
  // ignoriert die/den Spieler:in aber ab sofort bei der Plan-Erstellung.
  const mActive = useMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) =>
    api(`/players/${id}/active`, { method: "PATCH", body: JSON.stringify({ active }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["players-full"] }) });

  // Saisonwechsel-Werkzeug: ausgewählte Datenfelder der ausgewählten
  // Spieler auf einmal zurücksetzen. Alle nicht ausgewählten Felder (LK,
  // Kategorien, Wunschtrainer, ...) bleiben unangetastet.
  const mBulkClear = useMutation({
    mutationFn: ({ ids, fields }: { ids: string[]; fields: BulkClearField[] }) =>
      api("/players/bulk/clear", { method: "POST", body: JSON.stringify({ player_ids: ids, fields }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["players-full"] });
      setSelected(new Set());
    },
  });
  const [clearFields, setClearFields] = useState<Set<BulkClearField>>(new Set());
  function toggleClearField(f: BulkClearField) {
    setClearFields((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f); else next.add(f);
      return next;
    });
  }

  if (!authed) return <LoginRequired />;
  if (playersQ.isLoading) return <p>Lädt…</p>;
  const allList = playersQ.data ?? [];
  const list = allList.filter((p) => {
    if (search.trim() && !p.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (availFilter === "with" && p.availability.length === 0) return false;
    if (availFilter === "without" && p.availability.length > 0) return false;
    const hasNote = !!(p.preferences.notes ?? "").trim();
    if (notesFilter === "with" && !hasNote) return false;
    if (notesFilter === "without" && hasNote) return false;
    if (catFilter !== "all" && !(p.categories ?? []).includes(catFilter)) return false;
    const active = p.active !== false;
    if (activeFilter === "active" && !active) return false;
    if (activeFilter === "inactive" && active) return false;
    return true;
  });

  const allVisibleSelected = list.length > 0 && list.every((p) => selected.has(p.id));
  function toggleSelectAll() {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        list.forEach((p) => next.delete(p.id));
        return next;
      }
      const next = new Set(prev);
      list.forEach((p) => next.add(p.id));
      return next;
    });
  }
  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function clearSelectedFields() {
    const ids = [...selected];
    const fields = [...clearFields];
    if (ids.length === 0 || fields.length === 0) return;
    const fieldLabels = fields.map((f) => BULK_CLEAR_FIELD_LABEL[f]).join(", ");
    if (!window.confirm(
      `${fieldLabels} von ${ids.length} Spieler${ids.length === 1 ? "" : "n"} wirklich löschen? Das kann nicht rückgängig gemacht werden.`,
    )) return;
    mBulkClear.mutate({ ids, fields });
  }

  return (
    <section>
      <h2>Spieler</h2>

      {canEdit && (
        <div className="card" style={{ marginBottom: "var(--space-4)" }}>
          <h3 className="card__title">Neuen Spieler anlegen</h3>
          <div className="row">
            <input
              type="text" placeholder="Name des Spielers" value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && newName.trim() && createPlayer.mutate()}
              style={{ flex: 1 }}
            />
            <button onClick={() => createPlayer.mutate()} disabled={!newName.trim() || createPlayer.isPending}>
              {createPlayer.isPending ? "..." : "Anlegen"}
            </button>
          </div>
          {createPlayer.error && (
            <p style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)", margin: "var(--space-2) 0 0" }}>
              {(createPlayer.error as Error).message}
            </p>
          )}
        </div>
      )}

      {canExport && (
        <div className="card" style={{ marginBottom: "var(--space-4)" }}>
          <h3 className="card__title">Export</h3>
          <p className="muted" style={{ fontSize: "var(--text-xs)", margin: "0 0 var(--space-3)" }}>
            Alle Spieler- und Trainerdaten zur Auswertung außerhalb der App.
          </p>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button
              type="button" className="btn--secondary"
              disabled={exportBusy === "/export/players.xlsx"}
              onClick={() => runExport("/export/players.xlsx", "spieler.xlsx")}
            >
              {exportBusy === "/export/players.xlsx" ? "..." : "⬇️ Spieler (Excel)"}
            </button>
            <button
              type="button" className="btn--secondary"
              disabled={exportBusy === "/export/coaches.xlsx"}
              onClick={() => runExport("/export/coaches.xlsx", "trainer.xlsx")}
            >
              {exportBusy === "/export/coaches.xlsx" ? "..." : "⬇️ Trainer (Excel)"}
            </button>
            <button
              type="button" className="btn--secondary"
              disabled={exportBusy === "/export/people.xlsx"}
              onClick={() => runExport("/export/people.xlsx", "personen.xlsx")}
            >
              {exportBusy === "/export/people.xlsx" ? "..." : "⬇️ Beide (Excel)"}
            </button>
          </div>
          {exportError && (
            <p style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)", margin: "var(--space-2) 0 0" }}>
              {exportError}
            </p>
          )}
        </div>
      )}

      <div className="row" style={{ flexWrap: "wrap", gap: "var(--space-2)", marginBottom: "var(--space-3)", alignItems: "center" }}>
        <input
          type="text"
          placeholder={`Suche unter ${allList.length} Spielern…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: "100%", maxWidth: 340 }}
        />
        <select value={availFilter} onChange={(e) => setAvailFilter(e.target.value as typeof availFilter)}>
          <option value="all">Verfügbarkeit: alle</option>
          <option value="with">mit Verfügbarkeit</option>
          <option value="without">ohne Verfügbarkeit</option>
        </select>
        <select value={notesFilter} onChange={(e) => setNotesFilter(e.target.value as typeof notesFilter)}>
          <option value="all">Kommentar: alle</option>
          <option value="with">mit Kommentar</option>
          <option value="without">ohne Kommentar</option>
        </select>
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value as typeof catFilter)}>
          <option value="all">Kategorie: alle</option>
          {(Object.keys(CAT_LABEL) as Cat[]).map((c) => (
            <option key={c} value={c}>{CAT_LABEL[c]}</option>
          ))}
        </select>
        <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as typeof activeFilter)}>
          <option value="all">Status: alle</option>
          <option value="active">aktiv</option>
          <option value="inactive">pausiert</option>
        </select>
      </div>

      {canBulkClear && selected.size > 0 && (
        <div className="card" style={{ marginBottom: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <span>{selected.size} ausgewählt — zu löschende Felder:</span>
            {(Object.keys(BULK_CLEAR_FIELD_LABEL) as BulkClearField[]).map((f) => (
              <label key={f} className="label--inline" style={{ gap: 4, fontSize: "var(--text-sm)" }}>
                <input type="checkbox" checked={clearFields.has(f)} onChange={() => toggleClearField(f)} />
                {BULK_CLEAR_FIELD_LABEL[f]}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <button
              type="button" className="btn--danger"
              onClick={clearSelectedFields}
              disabled={mBulkClear.isPending || clearFields.size === 0}
            >
              {mBulkClear.isPending ? "..." : "🗑 Ausgewählte Felder löschen"}
            </button>
            <button type="button" className="btn--secondary" onClick={() => setSelected(new Set())}>
              Auswahl aufheben
            </button>
            {mBulkClear.error && (
              <span style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)" }}>
                {(mBulkClear.error as Error).message}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead>
            <tr>
              {canBulkClear && (
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAll}
                    title="Alle sichtbaren auswählen"
                  />
                </th>
              )}
              <th style={{ width: 80 }}>Aktiv</th>
              <th>Name</th>
              <th>LK</th>
              <th>Alter</th>
              <th>Std/Woche</th>
              <th>Verfügbarkeit</th>
              <th style={{ width: 90 }}>Kommentar</th>
              <th style={{ width: 110 }}></th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={canBulkClear ? 9 : 8} className="muted" style={{ padding: "var(--space-4)", textAlign: "center" }}>
                Keine Spieler gefunden.
              </td></tr>
            )}
            {list.map((p) => {
              const isOpen = openId === p.id;
              const lk = p.preferences.level_lk;
              const active = p.active !== false;
              return (
                <Fragment key={p.id}>
                  <tr
                    style={{ cursor: "pointer", opacity: active ? 1 : 0.55 }}
                    onClick={() => setOpenId(isOpen ? null : p.id)}
                  >
                    {canBulkClear && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          onChange={() => toggleSelect(p.id)}
                        />
                      </td>
                    )}
                    <td onClick={(e) => e.stopPropagation()}>
                      {canEdit ? (
                        <button
                          type="button"
                          title={active ? "Aktiv — klicken zum Pausieren" : "Pausiert — klicken zum Reaktivieren"}
                          onClick={() => mActive.mutate({ id: p.id, active: !active })}
                          disabled={mActive.isPending && mActive.variables?.id === p.id}
                          style={{
                            fontSize: 16, lineHeight: 1, padding: "2px 6px",
                            background: "none", border: "none", cursor: "pointer",
                          }}
                        >
                          {active ? "🟢" : "⚪"}
                        </button>
                      ) : (
                        <span style={{ fontSize: 16 }}>{active ? "🟢" : "⚪"}</span>
                      )}
                    </td>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td>
                      {lk != null
                        ? <span className="pill pill--accent">LK {lk}</span>
                        : <span className="muted" style={{ fontSize: "var(--text-xs)" }}>—</span>}
                    </td>
                    <td className="muted" style={{ fontSize: "var(--text-sm)" }}>
                      {p.preferences.age ?? "—"}
                    </td>
                    <td className="muted" style={{ fontSize: "var(--text-sm)" }}>
                      {fmtH(p.min_slots_per_week)}–{fmtH(p.max_slots_per_week)} h
                    </td>
                    <td>
                      {p.availability.length > 0
                        ? <span className="pill pill--accent">✓ {fmtH(p.availability.length)} h</span>
                        : <span style={{ color: "var(--color-danger)", fontSize: "var(--text-xs)" }}>— keine</span>}
                    </td>
                    <td style={{ textAlign: "center" }} title={(p.preferences.notes ?? "").trim() || undefined}>
                      {(p.preferences.notes ?? "").trim() ? "💬" : <span className="muted">—</span>}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button" className="btn--ghost"
                        style={{ fontSize: "var(--text-xs)", padding: "3px 10px" }}
                        onClick={(e) => { e.stopPropagation(); setOpenId(isOpen ? null : p.id); }}
                      >
                        {isOpen ? "▲ Zuklappen" : "▼ Details"}
                      </button>
                    </td>
                  </tr>

                  {isOpen && (
                    <tr>
                      <td colSpan={canBulkClear ? 9 : 8} style={{ padding: 0 }}>
                        <DetailPanel
                          player={p}
                          coaches={coachesQ.data ?? []}
                          allPlayers={allList}
                          canEdit={canEdit}
                          onLk={(lk)     => mLevel.mutate({ id: p.id, lk })}
                          onCats={(cats) => mCat.mutate({ id: p.id, cats })}
                          onPrefs={(cids) => mPrefs.mutate({ id: p.id, cids })}
                          onSessionTypes={(types) => mSessionTypes.mutate({ id: p.id, types })}
                          onMates={(ms)  => mMates.mutate({ id: p.id, mates: ms })}
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
          <p className="muted" style={{ padding: "var(--space-5)", margin: 0 }}>Noch keine Spieler angelegt.</p>
        )}
      </div>
    </section>
  );
}

type PanelProps = {
  player: PlayerFull; coaches: Coach[]; allPlayers: PlayerFull[]; canEdit: boolean;
  onLk: (lk: number | null) => void;
  onCats: (cats: Cat[]) => void;
  onPrefs: (coachIds: string[]) => void;
  onSessionTypes: (types: SessionTypePref[]) => void;
  onMates: (ms: Mate[]) => void;
};

function DetailPanel({ player, coaches, allPlayers, canEdit, onLk, onCats, onPrefs, onSessionTypes, onMates }: PanelProps) {
  const [lk,       setLk]       = useState<number | "">(player.preferences.level_lk ?? "");
  const [cats,     setCats]     = useState<Cat[]>((player.categories ?? []) as Cat[]);
  const [coachIds, setCoachIds] = useState<string[]>(player.preferences.preferred_coach_ids ?? []);
  const [sessionTypes, setSessionTypes] = useState<SessionTypePref[]>(
    player.preferences.allowed_session_types ?? ["single", "double", "group"],
  );
  const [mates,    setMates]    = useState<Mate[]>(player.mates ?? []);
  const [mateFilter, setMateFilter] = useState("");

  const toggleCoach = (id: string) => {
    const next = coachIds.includes(id) ? coachIds.filter(x => x !== id) : [...coachIds, id];
    setCoachIds(next);
    onPrefs(next);
  };
  const toggleCat = (c: Cat) => {
    const next = cats.includes(c) ? cats.filter(x => x !== c) : [...cats, c];
    setCats(next);
    onCats(next);
  };
  const toggleSessionType = (t: SessionTypePref) => {
    const next = sessionTypes.includes(t) ? sessionTypes.filter(x => x !== t) : [...sessionTypes, t];
    setSessionTypes(next);
    onSessionTypes(next);
  };
  const toggleMate = (pid: string) => {
    const exists = mates.find(m => m.player_id === pid);
    const next = exists
      ? mates.filter(m => m.player_id !== pid)
      : [...mates, { player_id: pid, mandatory: false }];
    setMates(next);
    onMates(next);
  };
  const setMandatory = (pid: string, mandatory: boolean) => {
    const next = mates.map(m => m.player_id === pid ? { ...m, mandatory } : m);
    setMates(next);
    onMates(next);
  };

  const notes = (player.preferences.notes ?? "").trim();
  const others = allPlayers.filter(q => q.id !== player.id);

  return (
    <div style={{ borderTop: "2px solid var(--color-primary-soft)", background: "var(--color-surface)" }}>

      {/* ── Top bar: LK + Kategorien ── */}
      <div style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-6)",
        padding: "var(--space-3) var(--space-4)",
        background: "var(--color-primary-soft)",
        borderBottom: "1px solid var(--color-border)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--color-primary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            LK
          </span>
          <input
            type="number" min={1} max={25} placeholder="—"
            value={lk}
            disabled={!canEdit}
            onChange={(e) => setLk(e.target.value === "" ? "" : Number(e.target.value))}
            onBlur={() => canEdit && onLk(lk === "" ? null : Number(lk))}
            style={{ width: 60, padding: "3px 8px", fontSize: "var(--text-sm)" }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--color-primary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Kategorie
          </span>
          {(Object.keys(CAT_LABEL) as Cat[]).map(c => (
            <Chip key={c} label={CAT_LABEL[c]} active={cats.includes(c)}
              disabled={!canEdit}
              onClick={() => canEdit && toggleCat(c)}
            />
          ))}
        </div>
      </div>

      {/* ── Kompakte obere Zeile: Wunschtrainer, Trainingsform, Kommentar ── */}
      <div style={{ display: "flex", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 220px", padding: "var(--space-4)", borderRight: "1px solid var(--color-border)" }}>
          <SectionHead title="Wunschtrainer" hint="Soft — Solver bevorzugt diesen Trainer" />
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", minHeight: 30 }}>
            {coaches.length === 0
              ? <span className="muted" style={{ fontSize: "var(--text-xs)" }}>Keine Trainer</span>
              : coaches.map(c => (
                  <Chip key={c.id} label={c.name} active={coachIds.includes(c.id)}
                    disabled={!canEdit} onClick={() => canEdit && toggleCoach(c.id)} />
                ))
            }
          </div>
        </div>

        <div style={{ flex: "1 1 220px", padding: "var(--space-4)", borderRight: "1px solid var(--color-border)" }}>
          <SectionHead
            title="Trainingsform"
            hint="Einzel=1, Zweier=2, Gruppentraining=3-4. Alle drei = keine Präferenz."
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
            {(["single", "double", "group"] as SessionTypePref[]).map((t) => (
              <Chip key={t} label={SESSION_TYPE_LABEL[t]} active={sessionTypes.includes(t)}
                disabled={!canEdit} onClick={() => canEdit && toggleSessionType(t)} />
            ))}
          </div>
        </div>

        <div style={{ flex: "1 1 220px", padding: "var(--space-4)" }}>
          <SectionHead title="Kommentar" hint="Vom Spieler selbst gepflegt" />
          {notes ? (
            <p style={{
              margin: 0, fontSize: "var(--text-sm)", color: "var(--color-text)",
              background: "var(--color-surface-muted)",
              padding: "var(--space-2) var(--space-3)",
              borderRadius: "var(--radius-sm)",
              borderLeft: "3px solid var(--color-border-strong)",
              whiteSpace: "pre-wrap",
            }}>
              {notes}
            </p>
          ) : (
            <span className="muted" style={{ fontSize: "var(--text-xs)" }}>Kein Kommentar</span>
          )}
        </div>
      </div>

      {/* ── Volle Breite darunter: Spielpartner, 4 Namen pro Zeile, ── */}
      {/* spaltenweise gefüllt (column-major) statt zeilenweise, damit man */}
      {/* pro Spalte alphabetisch von oben nach unten lesen kann. */}
      <div style={{ padding: "var(--space-4)", borderTop: "1px solid var(--color-border)" }}>
        <SectionHead
          title={`Spielpartner${mates.length > 0 ? ` · ${mates.length} ausgewählt` : ""}`}
          hint="Ausgewählt = Solver versucht Zusammenlegung · Pflicht = müssen immer gemeinsam trainieren"
        />
        {others.length > 8 && (
          <input
            type="text"
            placeholder="Spieler suchen…"
            value={mateFilter}
            onChange={(e) => setMateFilter(e.target.value)}
            style={{ marginBottom: "var(--space-2)", fontSize: "var(--text-sm)", maxWidth: 280 }}
          />
        )}
        {(() => {
          const filteredOthers = others
            .filter(q => q.name.toLowerCase().includes(mateFilter.trim().toLowerCase()))
            .sort((a, b) => {
              const ma = mates.some(x => x.player_id === a.id);
              const mb = mates.some(x => x.player_id === b.id);
              if (ma !== mb) return ma ? -1 : 1;
              return a.name.localeCompare(b.name, "de");
            });
          const cols = 4;
          const rows = Math.max(1, Math.ceil(filteredOthers.length / cols));
          return (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gridTemplateRows: `repeat(${rows}, auto)`,
                gridAutoFlow: "column",
                gap: "6px 12px",
              }}
            >
              {filteredOthers.length === 0 && (
                <span className="muted" style={{ fontSize: "var(--text-xs)" }}>Keine anderen Spieler</span>
              )}
              {filteredOthers.map(q => {
                const m = mates.find(x => x.player_id === q.id);
                return (
                  <div key={q.id} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
                    <label className="label--inline" style={{ gap: "var(--space-2)", minWidth: 0, flexShrink: 1 }}>
                      <input type="checkbox" checked={!!m} disabled={!canEdit}
                        onChange={() => canEdit && toggleMate(q.id)} />
                      <span style={{ fontSize: "var(--text-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {q.name}
                      </span>
                    </label>
                    {m && (
                      <label className="label--inline" style={{ gap: 4, fontSize: "var(--text-xs)", color: "var(--color-text-muted)", flexShrink: 0 }}>
                        <input type="checkbox" checked={!!m.mandatory} disabled={!canEdit}
                          onChange={(e) => canEdit && setMandatory(q.id, e.target.checked)} />
                        Pflicht
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
