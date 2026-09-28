import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, isLoggedIn, downloadFile } from "../../api/client";
import { PlanCalendar } from "./PlanCalendar";
import { LoginRequired, isAuthError } from "../../components/LoginRequired";
import { SLOTS_PER_DAY, slotLabel, WEEKDAYS } from "../../lib/timeGrid";
import { sortCourts } from "../../lib/sortCourts";

type Session = {
  coach_id: string;
  court_id: string;
  player_ids: string[];
  slot_indices: number[];
  session_type: string;
  label?: string | null;
  /** Kurzbeschreibung neben dem Trainer, z.B. "U15" — ergänzt die Spielerliste. */
  note?: string | null;
  /** Weitere Trainer derselben Einheit (nur manuell, nie vom Solver). */
  extra_coach_ids?: string[];
  /** Kurznotiz hinter einem Spielernamen, z.B. "gerade Wochen" — je Spieler und Einheit. */
  player_notes?: Record<string, string>;
};

type Plan = {
  id: string;
  season_id: string;
  score: number;
  explanation: string;
  sessions: Session[];
};

type Named = { id: string; name: string };
type CoachConstraints = {
  min_block_slots: number;
  max_slots_per_day: number | null;
  max_slots_per_week: number | null;
  min_break_slots: number;
  max_break_slots: number | null;
};
type CoachFull = { id: string; name: string; availability: number[]; constraints: CoachConstraints };
type PlayerFull = { id: string; name: string; availability: number[] };
type CourtFull = { id: string; name: string; availability: number[] };

const fmtH = (slots: number) => {
  const h = (slots * 30) / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
};

// Mirrors the (informative, non-blocking) conflict check the backend runs
// on save (PUT /plans/{id}) — plus availability/break/min-block checks the
// backend doesn't do — recomputed live on every edit so the warning shows
// up immediately instead of only after clicking "Speichern". Editing is
// deliberately unrestricted (e.g. two groups on the same court, or a
// booking outside someone's availability, are allowed — a coach might have
// a real reason), this is a heads-up only.
function computeWarnings(
  sessions: Session[],
  coaches: Record<string, CoachFull>,
  courts: Record<string, CourtFull>,
  players: Record<string, PlayerFull>,
): string[] {
  const warnings: string[] = [];
  const coachAt = new Map<string, number>();
  const courtAt = new Map<string, number>();
  const playerAt = new Map<string, number>();

  const label = (t: number) => {
    const day = Math.floor(t / SLOTS_PER_DAY);
    return `${WEEKDAYS[day] ?? "?"} ${slotLabel(t % SLOTS_PER_DAY)}`;
  };

  // ---- Per-session checks: double-booking, availability, min block length ----
  sessions.forEach((s, idx) => {
    // Haupt- und Zusatztrainer gleich behandeln — beide stehen real auf dem
    // Platz und koennen nicht gleichzeitig woanders sein.
    const sessionCoachIds = [s.coach_id, ...(s.extra_coach_ids ?? [])];
    const court = courts[s.court_id];
    const courtName = court?.name ?? "?";

    for (const t of s.slot_indices) {
      for (const cid of sessionCoachIds) {
        const c = coaches[cid];
        const cName = c?.name ?? "?";
        const ck = `${cid}@${t}`;
        if (coachAt.has(ck) && coachAt.get(ck) !== idx) {
          warnings.push(`Trainer ${cName} ist am ${label(t)} doppelt eingeteilt.`);
        } else {
          coachAt.set(ck, idx);
        }
        if (c && !c.availability.includes(t)) {
          warnings.push(`Trainer ${cName} hat am ${label(t)} keine Verfügbarkeit eingetragen.`);
        }
      }
      const rk = `${s.court_id}@${t}`;
      if (courtAt.has(rk) && courtAt.get(rk) !== idx) {
        warnings.push(`Platz ${courtName} ist am ${label(t)} doppelt belegt (zwei Gruppen gleichzeitig).`);
      } else {
        courtAt.set(rk, idx);
      }
      if (court && !court.availability.includes(t)) {
        warnings.push(`Platz ${courtName} hat am ${label(t)} keine Verfügbarkeit eingetragen.`);
      }
      for (const pid of s.player_ids) {
        const player = players[pid];
        const pname = player?.name ?? "?";
        const pk = `${pid}@${t}`;
        if (playerAt.has(pk) && playerAt.get(pk) !== idx) {
          warnings.push(`${pname} ist am ${label(t)} doppelt eingeteilt.`);
        } else {
          playerAt.set(pk, idx);
        }
        if (player && !player.availability.includes(t)) {
          warnings.push(`${pname} hat am ${label(t)} keine Verfügbarkeit eingetragen.`);
        }
      }
    }
  });

  // ---- Per-coach checks: daily/weekly hour caps and break length ----
  const coachAllSlots = new Map<string, Set<number>>();
  const coachDaySlots = new Map<string, Set<number>>(); // key `${coachId}@${day}`
  sessions.forEach((s) => {
    for (const cid of [s.coach_id, ...(s.extra_coach_ids ?? [])]) {
      for (const t of s.slot_indices) {
        if (!coachAllSlots.has(cid)) coachAllSlots.set(cid, new Set());
        coachAllSlots.get(cid)!.add(t);
        const day = Math.floor(t / SLOTS_PER_DAY);
        const dayKey = `${cid}@${day}`;
        if (!coachDaySlots.has(dayKey)) coachDaySlots.set(dayKey, new Set());
        coachDaySlots.get(dayKey)!.add(t);
      }
    }
  });

  for (const [coachId, allSlots] of coachAllSlots) {
    const coach = coaches[coachId];
    if (!coach || coach.constraints.max_slots_per_week == null) continue;
    if (allSlots.size > coach.constraints.max_slots_per_week) {
      warnings.push(
        `Trainer ${coach.name}: ${fmtH(allSlots.size)} Std/Woche eingeplant — Maximum ist ${fmtH(coach.constraints.max_slots_per_week)} Std.`,
      );
    }
  }

  for (const [dayKey, slotsSet] of coachDaySlots) {
    const [coachId, dayStr] = dayKey.split("@");
    const day = Number(dayStr);
    const coach = coaches[coachId];
    if (!coach) continue;
    const slots = [...slotsSet].sort((a, b) => a - b);

    if (coach.constraints.max_slots_per_day != null && slots.length > coach.constraints.max_slots_per_day) {
      warnings.push(
        `Trainer ${coach.name}: ${fmtH(slots.length)} Std am ${WEEKDAYS[day] ?? "?"} eingeplant — Maximum ist ${fmtH(coach.constraints.max_slots_per_day)} Std.`,
      );
    }

    // Contiguous working blocks for this coach on this day (spans multiple
    // back-to-back sessions/groups, not just one). min_block_slots means
    // "once the coach starts, they work at least this long before a
    // break" — it does NOT mean each individual group's session must be
    // that long; 3 different 1h groups in a row satisfy a 3h min block.
    const runs: number[][] = [];
    for (const t of slots) {
      const lastRun = runs[runs.length - 1];
      if (lastRun && t === lastRun[lastRun.length - 1] + 1) lastRun.push(t);
      else runs.push([t]);
    }
    if (coach.constraints.min_block_slots > 0) {
      for (const run of runs) {
        if (run.length < coach.constraints.min_block_slots) {
          warnings.push(
            `Trainer ${coach.name}: Block ab ${slotLabel(run[0] % SLOTS_PER_DAY)} am ${WEEKDAYS[day] ?? "?"} dauert nur ${fmtH(run.length)} Std am Stück — Mindest-Block ist ${fmtH(coach.constraints.min_block_slots)} Std.`,
          );
        }
      }
    }
    for (let i = 0; i < runs.length - 1; i++) {
      const prevEnd = runs[i][runs[i].length - 1];
      const nextStart = runs[i + 1][0];
      const gap = nextStart - prevEnd - 1;
      if (gap <= 0) continue;
      const gapLabel = `zwischen ${slotLabel(prevEnd % SLOTS_PER_DAY)} und ${slotLabel(nextStart % SLOTS_PER_DAY)} am ${WEEKDAYS[day] ?? "?"}`;
      if (coach.constraints.min_break_slots > 0 && gap < coach.constraints.min_break_slots) {
        warnings.push(`Trainer ${coach.name}: Pause ${gapLabel} ist nur ${fmtH(gap)} Std — Mindest-Pause ist ${fmtH(coach.constraints.min_break_slots)} Std.`);
      }
      if (coach.constraints.max_break_slots != null && gap > coach.constraints.max_break_slots) {
        warnings.push(`Trainer ${coach.name}: Pause ${gapLabel} ist ${fmtH(gap)} Std — erlaubt sind maximal ${fmtH(coach.constraints.max_break_slots)} Std.`);
      }
    }
  }

  return [...new Set(warnings)];
}

function canManage() {
  const role = sessionStorage.getItem("user_role");
  return role === "admin" || role === "planner";
}

// Herunterladen ist weniger heikel als Bearbeiten/Löschen — Trainer dürfen
// das auch, damit sie ihren Plan z.B. ausdrucken oder offline mitnehmen
// können, ohne gleich Admin/Planner-Rechte zu brauchen.
function canExportPlan() {
  const role = sessionStorage.getItem("user_role");
  return role === "admin" || role === "planner" || role === "coach";
}

export function PlanDetailPage() {
  const { planId } = useParams<{ planId: string }>();
  const authed = isLoggedIn();
  const qc = useQueryClient();
  const nav = useNavigate();

  const plan = useQuery({
    queryKey: ["plan", planId],
    queryFn: () => api<Plan>(`/plans/${planId}`),
    enabled: !!planId && authed,
  });
  // Full objects (not just id/name) — needed so the live warnings can check
  // availability and break/hour constraints, not just double-bookings.
  const coaches = useQuery({ queryKey: ["coaches"], queryFn: () => api<CoachFull[]>("/coaches"), enabled: authed });
  const players = useQuery({ queryKey: ["players"], queryFn: () => api<PlayerFull[]>("/players"), enabled: authed });
  const courts = useQuery({
    queryKey: ["courts"],
    queryFn: () => api<(CourtFull & { indoor: boolean })[]>("/courts"),
    enabled: authed,
  });
  const sortedCourts = useMemo(() => sortCourts(courts.data ?? []), [courts.data]);

  const coachesById = useMemo(() => Object.fromEntries((coaches.data ?? []).map((c) => [c.id, c])), [coaches.data]);
  const playersById = useMemo(() => Object.fromEntries((players.data ?? []).map((p) => [p.id, p])), [players.data]);
  const courtsById = useMemo(() => Object.fromEntries((courts.data ?? []).map((c) => [c.id, c])), [courts.data]);
  const coachMap = Object.fromEntries((coaches.data ?? []).map((c) => [c.id, c.name]));
  const playerMap = Object.fromEntries((players.data ?? []).map((p) => [p.id, p.name]));

  // ---- Edit state ----
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<Session[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  // A 60-min slot pre-selected by clicking an empty calendar cell — "+ Neue
  // Session" uses it as the default time/court instead of always Mo 07:00.
  const [pendingSlot, setPendingSlot] = useState<{ courtId: string; startSlot: number } | null>(null);
  const [exportBusy, setExportBusy] = useState<"xlsx" | "players" | "pdf" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  // Currently selected day tab in the calendar (0=Montag..6=Sonntag) —
  // reported up from PlanCalendar so "Neue Session" can default to the day
  // being looked at instead of always Montag.
  const [calendarDay, setCalendarDay] = useState(0);
  // Which courts are shown in the calendar — lifted up from PlanCalendar so
  // the session editor's "Platz" dropdown can list currently-visible courts
  // first, hidden ones after. `null` means "all visible".
  const [visibleCourtIds, setVisibleCourtIds] = useState<Set<string> | null>(null);
  // On first load, default to only the courts the plan actually uses (e.g.
  // an all-indoor plan starts with outdoor courts hidden) instead of
  // showing every court and making the user hide the unused ones by hand.
  // Only runs once per plan — after that the user's own toggles win.
  const autoVisibilityInitRef = useRef(false);
  useEffect(() => {
    if (autoVisibilityInitRef.current) return;
    if (!plan.data || !courts.data || courts.data.length === 0) return;
    autoVisibilityInitRef.current = true;
    const usedCourtIds = new Set(plan.data.sessions.map((s) => s.court_id));
    if (usedCourtIds.size > 0 && usedCourtIds.size < courts.data.length) {
      setVisibleCourtIds(usedCourtIds);
    }
  }, [plan.data, courts.data]);
  const courtsForEditor = useMemo(() => {
    if (visibleCourtIds === null) return sortedCourts;
    const visible = sortedCourts.filter((c) => visibleCourtIds.has(c.id));
    const hidden = sortedCourts.filter((c) => !visibleCourtIds.has(c.id));
    return [...visible, ...hidden];
  }, [sortedCourts, visibleCourtIds]);

  function enterEdit() {
    if (!plan.data) return;
    setDraft(plan.data.sessions.map((s) => ({ ...s, slot_indices: [...s.slot_indices], player_ids: [...s.player_ids], extra_coach_ids: [...(s.extra_coach_ids ?? [])], player_notes: { ...(s.player_notes ?? {}) } })));
    setSelectedIdx(null);
    setPendingSlot(null);
    setEditMode(true);
  }
  function cancelEdit() {
    setEditMode(false);
    setSelectedIdx(null);
    setPendingSlot(null);
    setDraft([]);
  }

  // Persists the whole draft (there's only ever one sessions array per
  // plan, so any save writes all of it) — but whether this *ends* editing
  // is decided per call site: the toolbar's "Speichern" finishes editing,
  // while the per-session save next to "Löschen" just persists progress
  // and keeps you in edit mode so you can keep adjusting other sessions.
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
    },
  });

  function finishEditing() {
    save.mutate(undefined, {
      onSuccess: () => {
        setEditMode(false);
        setSelectedIdx(null);
        setPendingSlot(null);
        setDraft([]);
      },
    });
  }

  const deletePlan = useMutation({
    mutationFn: () => api(`/plans/${planId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      nav("/plaene");
    },
  });

  function moveSession(idx: number, newStartSlot: number, newCourtId: string) {
    setDraft((d) => {
      const next = [...d];
      const s = next[idx];
      if (!s || s.slot_indices.length === 0) return d;
      const first = s.slot_indices[0]!;
      const delta = newStartSlot - first;
      // Clamp innerhalb desselben Tages.
      const targetDay = Math.floor(newStartSlot / SLOTS_PER_DAY);
      const dayStart = targetDay * SLOTS_PER_DAY;
      const dayEnd = dayStart + SLOTS_PER_DAY;
      const moved = s.slot_indices.map((x) => x + delta);
      if (moved.some((x) => x < dayStart || x >= dayEnd)) return d;
      next[idx] = { ...s, slot_indices: moved, court_id: newCourtId };
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
    if (!coaches.data?.length || !courtsForEditor.length) return;
    // Default: das per Klick auf den Stundenplan vorausgewählte Feld, wenn
    // vorhanden — sonst aktuell ausgewählter Tag, 07:00, 60 Minuten = 2 Slots.
    // courtsForEditor is visible-courts-first, so the fallback picks a
    // shown court by default instead of a hidden one.
    const base = calendarDay * SLOTS_PER_DAY;
    const courtId = pendingSlot?.courtId ?? courtsForEditor[0].id;
    const startSlot = pendingSlot?.startSlot ?? base;
    const newSession: Session = {
      coach_id: coaches.data[0].id,
      court_id: courtId,
      player_ids: [],
      slot_indices: [startSlot, startSlot + 1],
      session_type: "single",
      extra_coach_ids: [],
      player_notes: {},
    };
    setDraft((d) => {
      const next = [...d, newSession];
      setSelectedIdx(next.length - 1);
      return next;
    });
    setPendingSlot(null);
  }

  const displaySessions = editMode ? draft : plan.data?.sessions ?? [];
  const liveWarnings = useMemo(
    () => (editMode ? computeWarnings(draft, coachesById, courtsById, playersById) : []),
    [editMode, draft, coachesById, courtsById, playersById],
  );

  return (
    <section>
      <p><Link to="/plaene">← zurück zu den Trainingsplänen</Link></p>
      <h2>Trainingsplan</h2>
      {!authed && <LoginRequired />}
      {plan.isLoading && <p>lade...</p>}
      {plan.error && (isAuthError(plan.error) ? <LoginRequired /> : <p style={{ color: "var(--color-danger)" }}>Fehler beim Laden.</p>)}
      {plan.data && (
        <>
          <p>
            Score: <strong>{plan.data.score.toFixed(1)}</strong> ·
            Sessions: {displaySessions.length}
            {editMode && <em style={{ color: "var(--color-warning)", marginLeft: 8 }}>(Bearbeitungsmodus – nicht gespeichert)</em>}
          </p>

          {plan.data.explanation && (
            <ExplanationBlock text={plan.data.explanation} />
          )}

          {editMode && liveWarnings.length > 0 && (
            <div
              style={{
                background: "var(--color-primary-soft)",
                border: "1px solid var(--color-warning)",
                borderRadius: "var(--radius-md)",
                padding: "10px 14px",
                margin: "12px 0",
                fontSize: "var(--text-sm)",
              }}
            >
              <strong style={{ color: "var(--color-warning)" }}>⚠️ Konflikte in der aktuellen Bearbeitung</strong>
              <span className="muted" style={{ display: "block", fontSize: "var(--text-xs)", margin: "2px 0 6px" }}>
                Nur ein Hinweis — du darfst das trotzdem so speichern.
              </span>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {liveWarnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
            {!editMode ? (
              <>
                <button type="button" onClick={enterEdit}>✏️ Plan manuell bearbeiten</button>
                {canExportPlan() && (
                  <>
                    <button
                      type="button"
                      className="btn--secondary"
                      disabled={exportBusy === "xlsx"}
                      onClick={async () => {
                        setExportBusy("xlsx");
                        setExportError(null);
                        try {
                          await downloadFile(`/plans/${planId}/export.xlsx`, `trainingsplan-${planId?.slice(0, 8)}.xlsx`);
                        } catch (e) {
                          setExportError((e as Error).message);
                        } finally {
                          setExportBusy(null);
                        }
                      }}
                    >
                      {exportBusy === "xlsx" ? "..." : "⬇️ Excel"}
                    </button>
                    <button
                      type="button"
                      className="btn--secondary"
                      disabled={exportBusy === "players"}
                      title="Eine Zeile je Spieler mit seinen Trainingszeiten — zum Weitergeben an Eltern/Spieler"
                      onClick={async () => {
                        setExportBusy("players");
                        setExportError(null);
                        try {
                          await downloadFile(
                            `/plans/${planId}/export-players.xlsx`,
                            `spieler-zeiten-${planId?.slice(0, 8)}.xlsx`,
                          );
                        } catch (e) {
                          setExportError((e as Error).message);
                        } finally {
                          setExportBusy(null);
                        }
                      }}
                    >
                      {exportBusy === "players" ? "..." : "⬇️ Excel (je Spieler)"}
                    </button>
                    <button
                      type="button"
                      className="btn--secondary"
                      disabled={exportBusy === "pdf"}
                      onClick={async () => {
                        setExportBusy("pdf");
                        setExportError(null);
                        try {
                          await downloadFile(`/plans/${planId}/export.pdf`, `trainingsplan-${planId?.slice(0, 8)}.pdf`);
                        } catch (e) {
                          setExportError((e as Error).message);
                        } finally {
                          setExportBusy(null);
                        }
                      }}
                    >
                      {exportBusy === "pdf" ? "..." : "⬇️ PDF"}
                    </button>
                  </>
                )}
                {canManage() && (
                  <button
                    type="button"
                    className="btn--danger"
                    disabled={deletePlan.isPending}
                    onClick={() => {
                      if (window.confirm("Diese Plan-Variante wirklich unwiderruflich löschen?")) {
                        deletePlan.mutate();
                      }
                    }}
                  >
                    🗑 Plan löschen
                  </button>
                )}
                {(deletePlan.error || exportError) && (
                  <span style={{ color: "var(--color-danger)", alignSelf: "center" }}>
                    {exportError ?? (deletePlan.error as Error).message}
                  </span>
                )}
              </>
            ) : (
              <>
                <button type="button" onClick={finishEditing} disabled={save.isPending}>
                  💾 Speichern
                </button>
                <button type="button" onClick={addSession}>
                  + Neue Session
                  {pendingSlot && (() => {
                    const court = sortedCourts.find((c) => c.id === pendingSlot.courtId);
                    const d = Math.floor(pendingSlot.startSlot / SLOTS_PER_DAY);
                    const local = pendingSlot.startSlot % SLOTS_PER_DAY;
                    return ` (${WEEKDAYS[d]} ${slotLabel(local)}${court ? `, ${court.name}` : ""})`;
                  })()}
                </button>
                <button type="button" onClick={cancelEdit}>Abbrechen</button>
                {save.error && (
                  <span style={{ color: "var(--color-danger)", alignSelf: "center" }}>
                    Fehler: {(save.error as Error).message}
                  </span>
                )}
              </>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: editMode ? "1fr 320px" : "1fr", gap: 16 }}>
            <PlanCalendar
              sessions={displaySessions}
              courts={sortedCourts}
              coachNames={coachMap}
              playerNames={playerMap}
              editable={editMode}
              selectedIndex={selectedIdx}
              onSelect={(idx) => { setSelectedIdx(idx); setPendingSlot(null); }}
              onMove={moveSession}
              visibleCourtIds={visibleCourtIds}
              onVisibleCourtIdsChange={setVisibleCourtIds}
              onSelectedDayChange={(d) => { setCalendarDay(d); setPendingSlot(null); }}
              pendingSlot={pendingSlot}
              onPendingSlotChange={setPendingSlot}
            />

            {editMode && (
              <SessionEditor
                idx={selectedIdx}
                session={selectedIdx !== null ? draft[selectedIdx] : undefined}
                coaches={coaches.data ?? []}
                players={players.data ?? []}
                courts={courtsForEditor}
                onChange={(patch) => selectedIdx !== null && updateSession(selectedIdx, patch)}
                onDelete={() => selectedIdx !== null && deleteSession(selectedIdx)}
                onSave={() => save.mutate()}
                saving={save.isPending}
                saveError={save.error ? (save.error as Error).message : null}
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
  onSave,
  saving,
  saveError,
}: {
  idx: number | null;
  session: Session | undefined;
  coaches: Named[];
  players: Named[];
  courts: Named[];
  onChange: (patch: Partial<Session>) => void;
  onDelete: () => void;
  onSave: () => void;
  saving: boolean;
  saveError?: string | null;
}) {
  if (idx === null || !session) {
    return (
      <aside style={editorBox}>
        <h3 style={{ marginTop: 0 }}>Editor</h3>
        <p className="muted">
          Klicke auf eine Session im Plan, um sie zu bearbeiten. Per Drag &amp; Drop
          kannst du den Zeitpunkt verschieben (Dauer bleibt erhalten).
        </p>
        {saveError && <p style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)" }}>{saveError}</p>}
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
    // Notiz eines entfernten Spielers mit wegräumen, sonst bleibt sie als
    // unsichtbarer Rest hängen und taucht beim erneuten Hinzufügen wieder auf.
    const notes = { ...(s.player_notes ?? {}) };
    if (has) delete notes[pid];
    onChange({ player_ids: next, session_type: stype, player_notes: notes });
  }

  function setPlayerNote(pid: string, text: string) {
    const notes = { ...(s.player_notes ?? {}) };
    if (text) notes[pid] = text;
    else delete notes[pid];
    onChange({ player_notes: notes });
  }

  return (
    <aside style={editorBox}>
      <h3 style={{ marginTop: 0 }}>Session bearbeiten</h3>

      <label style={lbl}>Trainer
        <select value={s.coach_id} onChange={(e) => onChange({ coach_id: e.target.value })}>
          {coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>

      <ExtraCoachPicker
        coaches={coaches}
        mainCoachId={s.coach_id}
        extraIds={s.extra_coach_ids ?? []}
        onChange={(ids) => onChange({ extra_coach_ids: ids })}
      />

      <label style={lbl}>Beschreibung (optional)
        <input
          type="text"
          value={s.note ?? ""}
          onChange={(e) => onChange({ note: e.target.value || null })}
          placeholder="z.B. U15, Junioren…"
          maxLength={60}
        />
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
      <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", margin: "4px 0 8px" }}>
        = {duration * 30} Min ({slotLabel(localStart)}–{slotLabel(Math.min(SLOTS_PER_DAY - 1, localStart + duration))})
      </p>

      <div className="row" style={{ margin: "8px 0 4px", gap: 6 }}>
        <button
          type="button"
          className={s.label == null ? "btn--toggle-active" : "btn--secondary"}
          style={{ fontSize: "var(--text-xs)", padding: "3px 10px" }}
          onClick={() => onChange({ label: null })}
        >
          Spieler
        </button>
        <button
          type="button"
          className={s.label != null ? "btn--toggle-active" : "btn--secondary"}
          style={{ fontSize: "var(--text-xs)", padding: "3px 10px" }}
          onClick={() => onChange({ label: "", player_ids: [] })}
        >
          Text (z.B. Mannschaft)
        </button>
      </div>

      {s.label == null ? (
        <PlayerPicker
          players={players}
          selected={s.player_ids}
          onToggle={togglePlayer}
          notes={s.player_notes ?? {}}
          onNoteChange={setPlayerNote}
        />
      ) : (
        <label style={{ ...lbl, margin: "8px 0" }}>
          Bezeichnung (z.B. "Damen 30")
          <input
            type="text"
            value={s.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="Mannschaft / Text…"
            maxLength={100}
          />
        </label>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button type="button" onClick={onSave} disabled={saving} style={{ flex: 1 }}>
          {saving ? "speichere…" : "💾 Session speichern"}
        </button>
        <button type="button" className="btn--danger" onClick={onDelete}>
          🗑 Session löschen
        </button>
      </div>
      {saveError && <p style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)", marginTop: 8 }}>{saveError}</p>}
    </aside>
  );
}

// ---- Minimalistic markdown render for explanation block ----

function ExplanationBlock({ text }: { text: string }) {
  const lines = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div
      style={{
        background: "var(--color-surface-muted)",
        border: "1px solid var(--color-border)",
        borderLeft: "4px solid var(--color-border-strong)",
        borderRadius: "var(--radius-md)",
        padding: "10px 14px",
        margin: "12px 0",
        fontSize: "var(--text-sm)",
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
    else if (tok.startsWith("`")) tokens.push(<code key={key++} style={{ background: "var(--color-surface-muted)", padding: "0 3px", borderRadius: 3 }}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("_")) tokens.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < s.length) tokens.push(s.slice(last));
  return tokens;
}

const editorBox: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  padding: "var(--space-4)",
  background: "var(--color-surface)",
  fontSize: "var(--text-sm)",
  alignSelf: "start",
  position: "sticky",
  top: 12,
};
const lbl: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
  margin: "var(--space-2) 0",
  fontSize: "var(--text-sm)",
  color: "var(--color-text-muted)",
};

/**
 * Spielerauswahl für eine Session. Bei ~100 Spielern ist eine reine
 * Checkbox-Liste unbrauchbar: Die bereits gewählten stehen irgendwo
 * verstreut dazwischen, und um jemanden zu finden muss man scrollen.
 * Deshalb: Suchfeld, und die ausgewählten Spieler immer oben, unabhängig
 * vom Suchbegriff — so sieht man die aktuelle Gruppe auf einen Blick und
 * kann sie abwählen, ohne die Suche zurückzusetzen.
 */
function PlayerPicker({
  players,
  selected,
  onToggle,
  notes,
  onNoteChange,
}: {
  players: Named[];
  selected: string[];
  onToggle: (id: string) => void;
  notes: Record<string, string>;
  onNoteChange: (id: string, text: string) => void;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  // In Auswahl-Reihenfolge, damit die Gruppe stabil bleibt.
  const chosen = selected.map((id) => byId.get(id)).filter((p): p is Named => !!p);
  const rest = players.filter(
    (p) => !selected.includes(p.id) && (!query || p.name.toLowerCase().includes(query)),
  );

  return (
    <fieldset style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", padding: "8px 10px", margin: "8px 0" }}>
      <legend style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", padding: "0 4px" }}>
        Spieler ({selected.length})
      </legend>

      {chosen.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 6 }}>
          {chosen.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
              <label className="label--inline" style={{ flex: "1 1 auto", minWidth: 0 }}>
                <input type="checkbox" checked onChange={() => onToggle(p.id)} />
                <strong
                  style={{ fontSize: "var(--text-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {p.name}
                </strong>
              </label>
              <input
                type="text"
                value={notes[p.id] ?? ""}
                onChange={(e) => onNoteChange(p.id, e.target.value)}
                placeholder="Notiz…"
                maxLength={40}
                title={`Kurznotiz hinter "${p.name}", z.B. Förderkader oder gerade Wochen`}
                style={{ width: 110, flexShrink: 0, fontSize: "var(--text-xs)", padding: "2px 6px" }}
              />
            </div>
          ))}
          <hr style={{ border: 0, borderTop: "1px solid var(--color-border)", margin: "4px 0 0" }} />
        </div>
      )}

      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Suchen… (${players.length} Spieler)`}
        style={{ width: "100%", boxSizing: "border-box", fontSize: "var(--text-sm)", marginBottom: 6 }}
      />

      <div style={{ maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {rest.map((p) => (
          <label key={p.id} className="label--inline" style={{ padding: "3px 0" }}>
            <input type="checkbox" checked={false} onChange={() => onToggle(p.id)} />
            <span style={{ fontSize: "var(--text-sm)" }}>{p.name}</span>
          </label>
        ))}
        {rest.length === 0 && (
          <span className="muted" style={{ fontSize: "var(--text-xs)", padding: "4px 0" }}>
            {query ? "Keine Treffer" : "Alle Spieler sind bereits ausgewählt"}
          </span>
        )}
      </div>
    </fieldset>
  );
}

/**
 * Zusätzliche Trainer für eine Einheit — z.B. zwei Betreuer, die sich eine
 * große Zwerge-Gruppe auf einem Platz teilen. Der Solver plant immer nur
 * mit einem Trainer; hier lässt sich das von Hand ergänzen.
 */
function ExtraCoachPicker({
  coaches,
  mainCoachId,
  extraIds,
  onChange,
}: {
  coaches: Named[];
  mainCoachId: string;
  extraIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const byId = useMemo(() => new Map(coaches.map((c) => [c.id, c])), [coaches]);
  // Der Haupttrainer darf nicht doppelt auftauchen.
  const available = coaches.filter((c) => c.id !== mainCoachId && !extraIds.includes(c.id));
  const chosen = extraIds.map((id) => byId.get(id)).filter((c): c is Named => !!c);

  return (
    <div style={{ margin: "2px 0 8px" }}>
      <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginBottom: 3 }}>
        Weitere Trainer {chosen.length > 0 && `(${chosen.length})`}
      </span>
      {chosen.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
          {chosen.map((c) => (
            <button
              key={c.id}
              type="button"
              className="btn--secondary"
              style={{ fontSize: "var(--text-xs)", padding: "2px 8px" }}
              title="Entfernen"
              onClick={() => onChange(extraIds.filter((x) => x !== c.id))}
            >
              {c.name} ✕
            </button>
          ))}
        </div>
      )}
      {available.length > 0 && (
        <select
          value=""
          style={{ fontSize: "var(--text-sm)" }}
          onChange={(e) => {
            if (e.target.value) onChange([...extraIds, e.target.value]);
          }}
        >
          <option value="">– Trainer hinzufügen –</option>
          {available.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}
