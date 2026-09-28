import { useEffect, useMemo, useState } from "react";
import {
  SLOTS_PER_DAY,
  WEEKDAYS,
  slotIndex,
  slotLabel,
} from "../../lib/timeGrid";

type Session = {
  coach_id: string;
  court_id: string;
  player_ids: string[];
  slot_indices: number[];
  session_type: string;
  label?: string | null;
  note?: string | null;
  extra_coach_ids?: string[];
  player_notes?: Record<string, string>;
};

type Court = { id: string; name: string; indoor?: boolean };

type PendingSlot = { courtId: string; startSlot: number };

type Props = {
  sessions: Session[];
  courts: Court[];
  coachNames?: Record<string, string>;
  playerNames?: Record<string, string>;
  editable?: boolean;
  selectedIndex?: number | null;
  onSelect?: (idx: number) => void;
  /** Verschiebt Session `idx` auf `newStartSlot` und `newCourtId` (Dauer bleibt erhalten). */
  onMove?: (idx: number, newStartSlot: number, newCourtId: string) => void;
  /**
   * Which courts are shown — lifted up so the session editor can also see
   * it (to list currently-visible courts first). `null` means "all
   * visible" (the default before the user hides anything).
   */
  visibleCourtIds?: Set<string> | null;
  onVisibleCourtIdsChange?: (ids: Set<string> | null) => void;
  /**
   * Reports the currently selected day tab (0=Montag..6=Sonntag) up to the
   * parent — e.g. so "Neue Session" can default to the day currently being
   * looked at instead of always Montag. One-way only (this component still
   * owns the day-tab state itself).
   */
  onSelectedDayChange?: (day: number) => void;
  /**
   * A 60-min slot the user clicked on an empty cell to pre-select, shown
   * with a dashed outline — "Neue Session" (owned by the parent) picks it
   * up as the default time/court instead of always Mo 07:00. Fully
   * controlled by the parent, like `visibleCourtIds`.
   */
  pendingSlot?: PendingSlot | null;
  onPendingSlotChange?: (slot: PendingSlot | null) => void;
};

// Stable color per coach ID (hash → HSL).
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 60% 45%)`;
}

type Indexed = { s: Session; idx: number };
type DragOverCell = { courtId: string; startSlot: number };

/**
 * Renders one day at a time with courts side-by-side as columns — this
 * used to overlay every court's sessions on top of each other in the same
 * day cell, which made a busy day unreadable. A tab strip at the top picks
 * the day; each court gets its own column so parallel sessions are clearly
 * separated. When both indoor and outdoor courts are shown, they're split
 * into two separate grids (own header/time column each) so the two aren't
 * visually one big blur of columns.
 */
export function PlanCalendar({
  sessions,
  courts,
  coachNames,
  playerNames,
  editable = false,
  selectedIndex = null,
  onSelect,
  onMove,
  visibleCourtIds: visibleCourtIdsProp,
  onVisibleCourtIdsChange,
  onSelectedDayChange,
  pendingSlot = null,
  onPendingSlotChange,
}: Props) {
  const daysWithSessions = useMemo(() => {
    const set = new Set<number>();
    sessions.forEach((s) => {
      if (s.slot_indices.length) set.add(Math.floor(s.slot_indices[0] / SLOTS_PER_DAY));
    });
    return set;
  }, [sessions]);

  const [day, setDay] = useState<number>(() => {
    const first = [...daysWithSessions].sort((a, b) => a - b)[0];
    return first ?? 0;
  });
  useEffect(() => {
    onSelectedDayChange?.(day);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  // Which courts are shown — with many courts the grid gets too wide/busy,
  // so this defaults to all of them but can be narrowed down, same idea as
  // the day tabs. Controlled by the parent when `visibleCourtIds` is
  // passed (so the session editor can also see it, to list currently
  // visible courts first); falls back to local state otherwise.
  const [visibleCourtIdsLocal, setVisibleCourtIdsLocal] = useState<Set<string> | null>(null);
  const visibleCourtIds = onVisibleCourtIdsChange ? visibleCourtIdsProp ?? null : visibleCourtIdsLocal;
  const setVisibleCourtIds = (updater: (prev: Set<string> | null) => Set<string> | null) => {
    const next = updater(visibleCourtIds);
    if (onVisibleCourtIdsChange) onVisibleCourtIdsChange(next);
    else setVisibleCourtIdsLocal(next);
  };
  const shownCourts = useMemo(
    () => (visibleCourtIds === null ? courts : courts.filter((c) => visibleCourtIds.has(c.id))),
    [courts, visibleCourtIds],
  );
  function toggleCourt(id: string) {
    setVisibleCourtIds((prev) => {
      const base = prev ?? new Set(courts.map((c) => c.id));
      const next = new Set(base);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const isCourtVisible = (id: string) => visibleCourtIds === null || visibleCourtIds.has(id);
  const isGroupVisible = (indoor: boolean) => {
    const groupIds = courts.filter((c) => !!c.indoor === indoor).map((c) => c.id);
    return groupIds.length > 0 && groupIds.every(isCourtVisible);
  };
  function toggleGroup(indoor: boolean) {
    const groupIds = courts.filter((c) => !!c.indoor === indoor).map((c) => c.id);
    setVisibleCourtIds((prev) => {
      const base = prev ?? new Set(courts.map((c) => c.id));
      const next = new Set(base);
      const allVisible = groupIds.every((id) => next.has(id));
      for (const id of groupIds) {
        if (allVisible) next.delete(id); else next.add(id);
      }
      return next;
    });
  }
  const hasIndoorAndOutdoor = courts.some((c) => c.indoor) && courts.some((c) => !c.indoor);

  // Group this day's sessions by court (keep original global index for callbacks).
  const byCourt = useMemo(() => {
    const out = new Map<string, Indexed[]>();
    sessions.forEach((s, idx) => {
      if (!s.slot_indices.length) return;
      const sDay = Math.floor(s.slot_indices[0] / SLOTS_PER_DAY);
      if (sDay !== day) return;
      if (!out.has(s.court_id)) out.set(s.court_id, []);
      out.get(s.court_id)!.push({ s, idx });
    });
    return out;
  }, [sessions, day]);

  // Drag-and-drop hover feedback: which cell is currently under the
  // dragged session, and how many slots it spans (so the whole target
  // range gets outlined, not just the first half-hour).
  const [dragOverCell, setDragOverCell] = useState<DragOverCell | null>(null);
  const [draggingLen, setDraggingLen] = useState<number | null>(null);

  // Split into indoor/outdoor sub-grids only when both are actually shown
  // — otherwise (e.g. an outdoor-only club, or the other group fully
  // hidden) there's nothing to separate and the extra section header would
  // just be clutter.
  const shownIndoor = useMemo(() => shownCourts.filter((c) => c.indoor), [shownCourts]);
  const shownOutdoor = useMemo(() => shownCourts.filter((c) => !c.indoor), [shownCourts]);
  const splitRows = shownIndoor.length > 0 && shownOutdoor.length > 0;

  const gridProps = {
    byCourt,
    coachNames,
    playerNames,
    editable,
    selectedIndex,
    onSelect,
    onMove,
    pendingSlot,
    onPendingSlotChange,
    dragOverCell,
    setDragOverCell,
    draggingLen,
    setDraggingLen,
  };

  return (
    <div>
      <div className="muted" style={sectionHeading}>Wochentag</div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
        {WEEKDAYS.map((d, i) => (
          <button
            key={d}
            type="button"
            onClick={() => setDay(i)}
            className={i === day ? "btn--toggle-active" : "btn--secondary"}
            style={{ fontSize: "var(--text-xs)", padding: "5px 12px" }}
          >
            {d}{daysWithSessions.has(i) ? " •" : ""}
          </button>
        ))}
      </div>

      {courts.length > 1 && (
        <div style={{ marginBottom: 10 }}>
          <div className="muted" style={sectionHeading}>Plätze</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {hasIndoorAndOutdoor ? (
              <>
                <CourtToggleRow
                  groupLabel="🏠 Halle an/aus"
                  groupActive={isGroupVisible(true)}
                  onToggleGroup={() => toggleGroup(true)}
                  courts={courts.filter((c) => c.indoor)}
                  isCourtVisible={isCourtVisible}
                  onToggleCourt={toggleCourt}
                />
                <CourtToggleRow
                  groupLabel="☀️ Draußen an/aus"
                  groupActive={isGroupVisible(false)}
                  onToggleGroup={() => toggleGroup(false)}
                  courts={courts.filter((c) => !c.indoor)}
                  isCourtVisible={isCourtVisible}
                  onToggleCourt={toggleCourt}
                />
              </>
            ) : (
              <CourtToggleRow
                courts={courts}
                isCourtVisible={isCourtVisible}
                onToggleCourt={toggleCourt}
              />
            )}
          </div>
        </div>
      )}

      {shownCourts.length === 0 ? (
        <p className="muted">Keine Plätze ausgewählt.</p>
      ) : splitRows ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <CourtGridSection label="🏠 Halle" courts={shownIndoor} day={day} {...gridProps} />
          <CourtGridSection label="☀️ Draußen" courts={shownOutdoor} day={day} {...gridProps} />
        </div>
      ) : (
        <CourtGridSection courts={shownCourts} day={day} {...gridProps} />
      )}
    </div>
  );
}

/** One row of the "Plätze:" filter bar — optionally led by a group toggle
 * (Halle/Draußen an/aus) so indoor and outdoor courts get their own visually
 * separated row instead of one long, mixed line of buttons. */
function CourtToggleRow({
  label,
  groupLabel,
  groupActive,
  onToggleGroup,
  courts,
  isCourtVisible,
  onToggleCourt,
}: {
  label?: string;
  groupLabel?: string;
  groupActive?: boolean;
  onToggleGroup?: () => void;
  courts: Court[];
  isCourtVisible: (id: string) => boolean;
  onToggleCourt: (id: string) => void;
}) {
  if (courts.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
      {label && <span className="muted" style={{ fontSize: "var(--text-xs)" }}>{label}</span>}
      {groupLabel && onToggleGroup && (
        <>
          <button
            type="button"
            onClick={onToggleGroup}
            className={groupActive ? "btn--toggle-active" : "btn--secondary"}
            style={{ fontSize: "var(--text-xs)", padding: "4px 10px", fontWeight: 600 }}
          >
            {groupLabel}
          </button>
          <span style={{ width: 1, height: 16, background: "var(--color-border)", margin: "0 2px" }} />
        </>
      )}
      {courts.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onToggleCourt(c.id)}
          className={isCourtVisible(c.id) ? "btn--toggle-active" : "btn--secondary"}
          style={{ fontSize: "var(--text-xs)", padding: "4px 10px" }}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}

function CourtGridSection({
  label,
  courts,
  day,
  byCourt,
  coachNames,
  playerNames,
  editable,
  selectedIndex,
  onSelect,
  onMove,
  pendingSlot,
  onPendingSlotChange,
  dragOverCell,
  setDragOverCell,
  draggingLen,
  setDraggingLen,
}: {
  label?: string;
  courts: Court[];
  day: number;
  byCourt: Map<string, Indexed[]>;
  coachNames?: Record<string, string>;
  playerNames?: Record<string, string>;
  editable: boolean;
  selectedIndex: number | null;
  onSelect?: (idx: number) => void;
  onMove?: (idx: number, newStartSlot: number, newCourtId: string) => void;
  pendingSlot: PendingSlot | null;
  onPendingSlotChange?: (slot: PendingSlot | null) => void;
  dragOverCell: DragOverCell | null;
  setDragOverCell: (c: DragOverCell | null) => void;
  draggingLen: number | null;
  setDraggingLen: (n: number | null) => void;
}) {
  return (
    <div>
      {label && (
        <div className="muted" style={{ fontSize: "var(--text-xs)", fontWeight: 700, marginBottom: 4 }}>
          {label}
        </div>
      )}
      <div
        role="grid"
        aria-label={`Trainingsplan ${WEEKDAYS[day]}${label ? ` – ${label}` : ""}`}
        style={{
          display: "grid",
          gridTemplateColumns: `60px repeat(${courts.length}, minmax(110px, 1fr))`,
          gap: 1,
          background: "var(--color-border)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          position: "relative",
          fontSize: 12,
        }}
      >
        <div style={headerCell}>Zeit</div>
        {courts.map((c) => <div key={c.id} style={headerCell}>{c.name}</div>)}

        {Array.from({ length: SLOTS_PER_DAY }).map((_, row) => (
          <RowFragment
            key={row}
            row={row}
            day={day}
            courts={courts}
            byCourt={byCourt}
            coachNames={coachNames}
            playerNames={playerNames}
            editable={editable}
            selectedIndex={selectedIndex}
            onSelect={onSelect}
            onMove={onMove}
            pendingSlot={pendingSlot}
            onPendingSlotChange={onPendingSlotChange}
            dragOverCell={dragOverCell}
            setDragOverCell={setDragOverCell}
            draggingLen={draggingLen}
            setDraggingLen={setDraggingLen}
          />
        ))}
      </div>
    </div>
  );
}

function RowFragment({
  row,
  day,
  courts,
  byCourt,
  coachNames,
  playerNames,
  editable,
  selectedIndex,
  onSelect,
  onMove,
  pendingSlot,
  onPendingSlotChange,
  dragOverCell,
  setDragOverCell,
  draggingLen,
  setDraggingLen,
}: {
  row: number;
  day: number;
  courts: Court[];
  byCourt: Map<string, Indexed[]>;
  coachNames?: Record<string, string>;
  playerNames?: Record<string, string>;
  editable: boolean;
  selectedIndex: number | null;
  onSelect?: (idx: number) => void;
  onMove?: (idx: number, newStartSlot: number, newCourtId: string) => void;
  pendingSlot: PendingSlot | null;
  onPendingSlotChange?: (slot: PendingSlot | null) => void;
  dragOverCell: DragOverCell | null;
  setDragOverCell: (c: DragOverCell | null) => void;
  draggingLen: number | null;
  setDraggingLen: (n: number | null) => void;
}) {
  const cellSlot = slotIndex(day, row);
  // A new session defaults to 60 Min (2 Slots) — the very last slot of the
  // day can't start one, so clicking there to pre-select is disabled
  // rather than silently overflowing into the next day.
  const canPreselect = row < SLOTS_PER_DAY - 1;
  return (
    <>
      <div style={timeCell}>{slotLabel(row)}</div>
      {courts.map((court) => {
        const items = byCourt.get(court.id) ?? [];
        const starting = items.filter((it) => it.s.slot_indices[0] === cellSlot);
        const continuing = items.some(
          (it) => it.s.slot_indices.includes(cellSlot) && it.s.slot_indices[0] !== cellSlot,
        );
        const isPending =
          !!pendingSlot &&
          pendingSlot.courtId === court.id &&
          (cellSlot === pendingSlot.startSlot || cellSlot === pendingSlot.startSlot + 1);
        const isDragOver =
          !!dragOverCell &&
          dragOverCell.courtId === court.id &&
          cellSlot >= dragOverCell.startSlot &&
          cellSlot < dragOverCell.startSlot + (draggingLen ?? 1);
        const cellHandlers = editable && onMove
          ? {
              onDragOver: (e: React.DragEvent) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDragOverCell({ courtId: court.id, startSlot: cellSlot });
              },
              onDrop: (e: React.DragEvent) => {
                e.preventDefault();
                setDragOverCell(null);
                setDraggingLen(null);
                const raw = e.dataTransfer.getData("text/sid");
                if (!raw) return;
                const sid = Number(raw);
                if (Number.isFinite(sid)) onMove(sid, cellSlot, court.id);
              },
            }
          : {};
        const onCellClick =
          editable && !starting.length && !continuing && canPreselect
            ? () => {
                const isSame = pendingSlot?.courtId === court.id && pendingSlot?.startSlot === cellSlot;
                onPendingSlotChange?.(isSame ? null : { courtId: court.id, startSlot: cellSlot });
              }
            : undefined;
        return (
          <div
            key={court.id}
            role="gridcell"
            onClick={onCellClick}
            {...cellHandlers}
            style={{
              background: continuing ? "transparent" : "var(--color-surface)",
              minHeight: 22,
              position: "relative",
              padding: 0,
              cursor: onCellClick ? "pointer" : undefined,
              // Pending-slot pick: dashed outline. Drag-hover: solid inset
              // ring. Both use the same "toggle" accent so they read as
              // "this is a selection/target", not the primary blue action
              // color, and not the selected-session blue ring below.
              outline: isPending ? "2px dashed var(--color-toggle)" : undefined,
              outlineOffset: isPending ? -2 : undefined,
              boxShadow: isDragOver ? "inset 0 0 0 2px var(--color-toggle)" : undefined,
            }}
          >
            {starting.map(({ s, idx }) => {
              const span = s.slot_indices.length;
              const color = colorFor(s.coach_id);
              // Haupttrainer zuerst, danach evtl. manuell ergaenzte
              // Zusatztrainer (z.B. zwei Betreuer bei einer grossen Gruppe).
              const coach = [s.coach_id, ...(s.extra_coach_ids ?? [])]
                .map((cid) => coachNames?.[cid] ?? cid.slice(0, 6))
                .join(" + ");
              const players = s.label
                ? s.label
                : s.player_ids
                    .map((p) => {
                      const name = playerNames?.[p] ?? p.slice(0, 4);
                      const pn = s.player_notes?.[p];
                      return pn ? `${name} (${pn})` : name;
                    })
                    .join(", ");
              const isSelected = selectedIndex === idx;
              return (
                <div
                  key={idx}
                  title={`${coach} · ${court.name}\n${players}`}
                  draggable={editable}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/sid", String(idx));
                    setDraggingLen(s.slot_indices.length);
                  }}
                  onDragEnd={() => {
                    setDraggingLen(null);
                    setDragOverCell(null);
                  }}
                  onClick={() => onSelect?.(idx)}
                  style={{
                    position: "absolute",
                    inset: `0 1px 0 1px`,
                    // Explicit z-index (not just position:absolute) so this
                    // block's overflow into later time-rows actually
                    // receives clicks — without it, the later rows' own
                    // (empty, but still positioned) grid cells paint over
                    // the tail and swallow clicks, so only the first
                    // half-hour of a longer session was ever clickable.
                    zIndex: isSelected ? 3 : 2,
                    height: span * 22 + (span - 1),
                    background: color,
                    color: "#fff",
                    borderRadius: 3,
                    padding: "2px 4px",
                    overflow: "hidden",
                    fontSize: 11,
                    lineHeight: 1.15,
                    boxShadow: isSelected
                      ? "0 0 0 2px var(--color-surface), 0 0 0 4px var(--color-primary)"
                      : "0 1px 2px rgba(0,0,0,.15)",
                    cursor: editable ? "grab" : "default",
                    outline: "none",
                  }}
                >
                  {/* minWidth:0 lässt den Trainernamen schrumpfen statt die
                      Beschreibung hinauszudrängen (Flex-Elemente sind sonst
                      mindestens so breit wie ihr Inhalt). Die Beschreibung
                      ist kurz und wichtig, bleibt also ungekürzt.
                      paddingRight am kursiven Text: kursive Glyphen ragen
                      rechts über ihre berechnete Breite hinaus — ohne die
                      zusätzliche Luft kappt das overflow:hidden der Kachel
                      den letzten Buchstaben leicht an. */}
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
                    <strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {coach}
                    </strong>
                    {s.note && (
                      <span
                        style={{
                          marginLeft: "auto", flexShrink: 0, opacity: 0.85, fontStyle: "italic",
                          whiteSpace: "nowrap", maxWidth: "60%", paddingRight: 2,
                          overflow: "hidden", textOverflow: "ellipsis",
                        }}
                      >
                        {s.note}
                      </span>
                    )}
                  </div>
                  {players}
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

const sectionHeading: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  marginBottom: 4,
};
const headerCell: React.CSSProperties = {
  background: "var(--color-surface-muted)",
  padding: "6px 4px",
  textAlign: "center",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  fontSize: 11,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};
const timeCell: React.CSSProperties = {
  background: "var(--color-surface-muted)",
  padding: "2px 4px",
  textAlign: "right",
  color: "var(--color-text-soft)",
  fontSize: 11,
};
