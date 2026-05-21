import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import { api, isLoggedIn } from "../../api/client";
import { PlanCalendar } from "./PlanCalendar";
import { LoginRequired, isAuthError } from "../../components/LoginRequired";
import { SLOTS_PER_DAY, slotLabel, WEEKDAYS } from "../../lib/timeGrid";

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
  const qc = useQueryClient();

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

  // ---- Edit state ----
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<Session[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  function enterEdit() {
    if (!plan.data) return;
    setDraft(plan.data.sessions.map((s) => ({ ...s, slot_indices: [...s.slot_indices], player_ids: [...s.player_ids] })));
    setSelectedIdx(null);
    setEditMode(true);
  }
  function cancelEdit() {
    setEditMode(false);
    setSelectedIdx(null);
    setDraft([]);
  }

  const save = useMutation({
    mutationFn: async () => {
      return api<Plan>(`/plans/${planId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessions: draft }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plan", planId] });
      qc.invalidateQueries({ queryKey: ["plans"] });
      setEditMode(false);
      setSelectedIdx(null);
      setDraft([]);
    },
  });

  function moveSession(idx: number, newStartSlot: number) {
    setDraft((d) => {
      const next = [...d];
      const s = next[idx];
      if (!s || s.slot_indices.length === 0) return d;
      const first = s.slot_indices[0]!;
      const delta = newStartSlot - first;
      // Clamp innerhalb desselben Tages? Wir lassen frei aber clampen zu Tagesgrenzen.
      const targetDay = Math.floor(newStartSlot / SLOTS_PER_DAY);
      const dayStart = targetDay * SLOTS_PER_DAY;
      const dayEnd = dayStart + SLOTS_PER_DAY;
      const moved = s.slot_indices.map((x) => x + delta);
      if (moved.some((x) => x < dayStart || x >= dayEnd)) return d;
      next[idx] = { ...s, slot_indices: moved };
      return next;
    });
  }

  function updateSession(idx: number, patch: Partial<Session>) {
    setDraft((d) => {
      const next = [...d];
      const cur = next[idx];
      if (!cur) return d;
      next[idx] = { ...cur, ...patch };
      return next;
    });
  }

  function deleteSession(idx: number) {
    setDraft((d) => d.filter((_, i) => i !== idx));
    setSelectedIdx(null);
  }

  function addSession() {
    if (!coaches.data?.length || !courts.data?.length) return;
    // default: Mo 07:00, 60 Minuten = 2 slots
    const newSession: Session = {
      coach_id: coaches.data[0].id,
      court_id: courts.data[0].id,
      player_ids: [],
      slot_indices: [0, 1],
      session_type: "single",
    };
    setDraft((d) => {
      const next = [...d, newSession];
      setSelectedIdx(next.length - 1);
      return next;
    });
  }

  const displaySessions = editMode ? draft : plan.data?.sessions ?? [];

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
            Sessions: {displaySessions.length}
            {editMode && <em style={{ color: "#a55", marginLeft: 8 }}>(Bearbeitungsmodus - nicht gespeichert)</em>}
          </p>

          {plan.data.explanation && (
            <ExplanationBlock text={plan.data.explanation} />
          )}

          <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
            {!editMode ? (
              <button type="button" onClick={enterEdit}>✏️ Plan manuell bearbeiten</button>
            ) : (
              <>
                <button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
                  💾 Speichern
                </button>
                <button type="button" onClick={addSession}>+ Neue Session</button>
                <button type="button" onClick={cancelEdit}>Abbrechen</button>
                {save.error && (
                  <span style={{ color: "crimson" }}>
                    Fehler: {(save.error as Error).message}
                  </span>
                )}
              </>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: editMode ? "1fr 320px" : "1fr", gap: 16 }}>
            <PlanCalendar
              sessions={displaySessions}
              coachNames={coachMap}
              playerNames={playerMap}
              courtNames={courtMap}
              editable={editMode}
              selectedIndex={selectedIdx}
              onSelect={setSelectedIdx}
              onMove={moveSession}
            />

            {editMode && (
              <SessionEditor
                idx={selectedIdx}
                session={selectedIdx !== null ? draft[selectedIdx] : undefined}
                coaches={coaches.data ?? []}
                players={players.data ?? []}
                courts={courts.data ?? []}
                onChange={(patch) => selectedIdx !== null && updateSession(selectedIdx, patch)}
                onDelete={() => selectedIdx !== null && deleteSession(selectedIdx)}
              />
            )}
          </div>
        </>
      )}
    </section>
  );
}

// ---- Sidebar editor ----

function SessionEditor({
  idx,
  session,
  coaches,
  players,
  courts,
  onChange,
  onDelete,
}: {
  idx: number | null;
  session: Session | undefined;
  coaches: Named[];
  players: Named[];
  courts: Named[];
  onChange: (patch: Partial<Session>) => void;
  onDelete: () => void;
}) {
  if (idx === null || !session) {
    return (
      <aside style={editorBox}>
        <h3 style={{ marginTop: 0 }}>Editor</h3>
        <p style={{ color: "#666" }}>
          Klicke auf eine Session im Plan, um sie zu bearbeiten. Per Drag &amp; Drop
          kannst du den Zeitpunkt verschieben (Dauer bleibt erhalten).
        </p>
      </aside>
    );
  }
  const s: Session = session;

  const startSlot = s.slot_indices[0] ?? 0;
  const day = Math.floor(startSlot / SLOTS_PER_DAY);
  const localStart = startSlot % SLOTS_PER_DAY;
  const duration = s.slot_indices.length;

  function setStart(newDay: number, newLocal: number) {
    const base = newDay * SLOTS_PER_DAY + newLocal;
    const slots = Array.from({ length: duration }, (_, i) => base + i);
    const last = slots[slots.length - 1];
    if (last === undefined || last >= (newDay + 1) * SLOTS_PER_DAY) return;
    onChange({ slot_indices: slots });
  }

  function setDuration(newDur: number) {
    if (newDur < 1) return;
    const base = s.slot_indices[0];
    if (base === undefined) return;
    const dayEnd = (Math.floor(base / SLOTS_PER_DAY) + 1) * SLOTS_PER_DAY;
    const slots = Array.from({ length: newDur }, (_, i) => base + i);
    const last = slots[slots.length - 1];
    if (last === undefined || last >= dayEnd) return;
    onChange({ slot_indices: slots });
  }

  function togglePlayer(pid: string) {
    const has = s.player_ids.includes(pid);
    const next = has
      ? s.player_ids.filter((x) => x !== pid)
      : [...s.player_ids, pid];
    let stype: string = s.session_type;
    if (next.length <= 1) stype = "single";
    else if (next.length === 2) stype = "double";
    else stype = "group";
    onChange({ player_ids: next, session_type: stype });
  }

  return (
    <aside style={editorBox}>
      <h3 style={{ marginTop: 0 }}>Session bearbeiten</h3>

      <label style={lbl}>Trainer
        <select value={s.coach_id} onChange={(e) => onChange({ coach_id: e.target.value })}>
          {coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>

      <label style={lbl}>Platz
        <select value={s.court_id} onChange={(e) => onChange({ court_id: e.target.value })}>
          {courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>

      <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
        <label style={{ ...lbl, flex: 1 }}>Tag
          <select value={day} onChange={(e) => setStart(Number(e.target.value), localStart)}>
            {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </label>
        <label style={{ ...lbl, flex: 1 }}>Start
          <select value={localStart} onChange={(e) => setStart(day, Number(e.target.value))}>
            {Array.from({ length: SLOTS_PER_DAY }).map((_, i) => (
              <option key={i} value={i}>{slotLabel(i)}</option>
            ))}
          </select>
        </label>
        <label style={{ ...lbl, width: 80 }}>Slots
          <input
            type="number"
            min={1}
            max={SLOTS_PER_DAY - localStart}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </label>
      </div>
      <p style={{ fontSize: 11, color: "#666", margin: "4px 0 8px" }}>
        = {duration * 30} Min ({slotLabel(localStart)}–{slotLabel(Math.min(SLOTS_PER_DAY - 1, localStart + duration))})
      </p>

      <fieldset style={{ border: "1px solid #ddd", padding: 8, margin: "8px 0" }}>
        <legend>Spieler ({s.player_ids.length})</legend>
        <div style={{ maxHeight: 200, overflowY: "auto" }}>
          {players.map((p) => (
            <label key={p.id} style={{ display: "block", fontSize: 12, padding: "2px 0" }}>
              <input
                type="checkbox"
                checked={s.player_ids.includes(p.id)}
                onChange={() => togglePlayer(p.id)}
              />
              {" "}{p.name}
            </label>
          ))}
        </div>
      </fieldset>

      <button type="button" onClick={onDelete} style={{ color: "crimson" }}>
        🗑 Session löschen
      </button>
    </aside>
  );
}

// ---- Minimalistic markdown render for explanation block ----

function ExplanationBlock({ text }: { text: string }) {
  const lines = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div
      style={{
        background: "#fafafa",
        border: "1px solid #e4e4e4",
        borderLeft: "4px solid #888",
        borderRadius: 4,
        padding: "10px 14px",
        margin: "12px 0",
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      {lines}
    </div>
  );
}

function renderMarkdown(src: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const lines = src.split("\n");
  let listBuf: string[] = [];
  let key = 0;

  function flushList() {
    if (!listBuf.length) return;
    const items = listBuf;
    listBuf = [];
    out.push(
      <ul key={`l${key++}`} style={{ margin: "4px 0 8px 20px", padding: 0 }}>
        {items.map((it, i) => <li key={i}>{renderInline(it)}</li>)}
      </ul>,
    );
  }

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      flushList();
      out.push(<h3 key={`h${key++}`} style={{ margin: "6px 0" }}>{renderInline(line.slice(3))}</h3>);
    } else if (line.startsWith("# ")) {
      flushList();
      out.push(<h2 key={`h${key++}`} style={{ margin: "6px 0" }}>{renderInline(line.slice(2))}</h2>);
    } else if (line.startsWith("- ")) {
      listBuf.push(line.slice(2));
    } else if (line === "") {
      flushList();
    } else {
      flushList();
      out.push(<p key={`p${key++}`} style={{ margin: "4px 0" }}>{renderInline(line)}</p>);
    }
  }
  flushList();
  return out;
}

function renderInline(s: string): React.ReactNode[] {
  // Reihenfolge: **bold**, dann _italic_, dann `code`.
  const tokens: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) tokens.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) tokens.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) tokens.push(<code key={key++} style={{ background: "#eee", padding: "0 3px" }}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("_")) tokens.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < s.length) tokens.push(s.slice(last));
  return tokens;
}

const editorBox: React.CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 6,
  padding: 12,
  background: "#fcfcfc",
  fontSize: 13,
  alignSelf: "start",
  position: "sticky",
  top: 12,
};
const lbl: React.CSSProperties = {
  display: "block",
  margin: "6px 0",
  fontSize: 12,
};
