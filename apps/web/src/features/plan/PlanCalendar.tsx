import { useMemo } from "react";
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
};

type Props = {
  sessions: Session[];
  coachNames?: Record<string, string>;
  courtNames?: Record<string, string>;
  playerNames?: Record<string, string>;
  editable?: boolean;
  selectedIndex?: number | null;
  onSelect?: (idx: number) => void;
  /** Verschiebt Session `idx` so dass ihr erster Slot auf `newStartSlot` liegt. Dauer bleibt erhalten. */
  onMove?: (idx: number, newStartSlot: number) => void;
};

// Stable color per coach ID (hash → HSL).
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 60% 45%)`;
}

type Indexed = { s: Session; idx: number };

/**
 * Renders the weekly grid with all training sessions overlaid.
 * Sessions span their slot range in the appropriate weekday column.
 */
export function PlanCalendar({
  sessions,
  coachNames,
  courtNames,
  playerNames,
  editable = false,
  selectedIndex = null,
  onSelect,
  onMove,
}: Props) {
  // Group sessions by weekday for placement (keep original global index for callbacks).
  const byDay = useMemo(() => {
    const out: Indexed[][] = Array.from({ length: 7 }, () => []);
    sessions.forEach((s, idx) => {
      if (!s.slot_indices.length) return;
      const day = Math.floor(s.slot_indices[0] / SLOTS_PER_DAY);
      out[day].push({ s, idx });
    });
    return out;
  }, [sessions]);

  return (
    <div
      role="grid"
      aria-label="Wochentrainings-Plan"
      style={{
        display: "grid",
        gridTemplateColumns: `60px repeat(7, 1fr)`,
        gap: 1,
        background: "#ddd",
        border: "1px solid #ddd",
        position: "relative",
        fontSize: 12,
      }}
    >
      <div style={headerCell}>Zeit</div>
      {WEEKDAYS.map((d) => <div key={d} style={headerCell}>{d}</div>)}

      {Array.from({ length: SLOTS_PER_DAY }).map((_, row) => (
        <RowFragment
          key={row}
          row={row}
          byDay={byDay}
          coachNames={coachNames}
          courtNames={courtNames}
          playerNames={playerNames}
          editable={editable}
          selectedIndex={selectedIndex}
          onSelect={onSelect}
          onMove={onMove}
        />
      ))}
    </div>
  );
}

function RowFragment({
  row,
  byDay,
  coachNames,
  courtNames,
  playerNames,
  editable,
  selectedIndex,
  onSelect,
  onMove,
}: {
  row: number;
  byDay: Indexed[][];
  coachNames?: Record<string, string>;
  courtNames?: Record<string, string>;
  playerNames?: Record<string, string>;
  editable: boolean;
  selectedIndex: number | null;
  onSelect?: (idx: number) => void;
  onMove?: (idx: number, newStartSlot: number) => void;
}) {
  return (
    <>
      <div style={timeCell}>{slotLabel(row)}</div>
      {WEEKDAYS.map((_d, day) => {
        const cellSlot = slotIndex(day, row);
        const starting = byDay[day].filter((it) => it.s.slot_indices[0] === cellSlot);
        const continuing = byDay[day].some(
          (it) => it.s.slot_indices.includes(cellSlot) && it.s.slot_indices[0] !== cellSlot,
        );
        const cellHandlers = editable && onMove
          ? {
              onDragOver: (e: React.DragEvent) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              },
              onDrop: (e: React.DragEvent) => {
                e.preventDefault();
                const raw = e.dataTransfer.getData("text/sid");
                if (!raw) return;
                const sid = Number(raw);
                if (Number.isFinite(sid)) onMove(sid, cellSlot);
              },
            }
          : {};
        return (
          <div
            key={day}
            role="gridcell"
            {...cellHandlers}
            style={{
              background: continuing ? "transparent" : "#fff",
              minHeight: 22,
              position: "relative",
              padding: 0,
            }}
          >
            {starting.map(({ s, idx }) => {
              const span = s.slot_indices.length;
              const color = colorFor(s.coach_id);
              const coach = coachNames?.[s.coach_id] ?? s.coach_id.slice(0, 6);
              const court = courtNames?.[s.court_id] ?? "";
              const players = s.player_ids
                .map((p) => playerNames?.[p] ?? p.slice(0, 4))
                .join(", ");
              const isSelected = selectedIndex === idx;
              return (
                <div
                  key={idx}
                  title={`${coach} · ${court}\n${players}`}
                  draggable={editable}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/sid", String(idx));
                  }}
                  onClick={() => onSelect?.(idx)}
                  style={{
                    position: "absolute",
                    inset: `0 1px 0 1px`,
                    height: span * 22 + (span - 1),
                    background: color,
                    color: "#fff",
                    borderRadius: 3,
                    padding: "2px 4px",
                    overflow: "hidden",
                    fontSize: 11,
                    lineHeight: 1.15,
                    boxShadow: isSelected
                      ? "0 0 0 2px #111, 0 1px 2px rgba(0,0,0,.3)"
                      : "0 1px 2px rgba(0,0,0,.15)",
                    cursor: editable ? "grab" : "default",
                    outline: isSelected ? "2px solid #ffeb3b" : "none",
                  }}
                >
                  <strong>{coach}</strong>
                  <br />
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

const headerCell: React.CSSProperties = {
  background: "#f5f5f5",
  padding: "6px 4px",
  textAlign: "center",
  fontWeight: 600,
};
const timeCell: React.CSSProperties = {
  background: "#fafafa",
  padding: "2px 4px",
  textAlign: "right",
  color: "#666",
};
