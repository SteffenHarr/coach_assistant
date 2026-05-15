import { useCallback, useMemo, useRef, useState } from "react";
import {
  SLOTS_PER_DAY,
  WEEKDAYS,
  slotIndex,
  slotLabel,
} from "../../lib/timeGrid";

type Props = {
  value: number[];                       // selected slot indices (0..209)
  onChange: (next: number[]) => void;
  readOnly?: boolean;
};

/**
 * Klickbarer Wochen-Raster-Editor (Mo–So × 07:00–22:00 in 30-Min-Slots).
 * - Klick toggelt einen Slot.
 * - Maus gedrückt halten + ziehen = Bereich markieren (Modus folgt dem Start-Toggle).
 * - Vollständig keyboard-bedienbar (Pfeiltasten + Leertaste).
 */
export function AvailabilityGrid({ value, onChange, readOnly }: Props) {
  const selected = useMemo(() => new Set(value), [value]);
  const [drag, setDrag] = useState<{ mode: "add" | "remove" } | null>(null);
  const focusRef = useRef<{ day: number; row: number }>({ day: 0, row: 0 });

  const toggle = useCallback(
    (idx: number, mode: "add" | "remove" | "toggle") => {
      const next = new Set(selected);
      if (mode === "toggle") {
        next.has(idx) ? next.delete(idx) : next.add(idx);
      } else if (mode === "add") {
        next.add(idx);
      } else {
        next.delete(idx);
      }
      onChange([...next].sort((a, b) => a - b));
    },
    [selected, onChange],
  );

  const onCellMouseDown = (idx: number) => {
    if (readOnly) return;
    const mode: "add" | "remove" = selected.has(idx) ? "remove" : "add";
    setDrag({ mode });
    toggle(idx, mode);
  };

  const onCellMouseEnter = (idx: number) => {
    if (!drag || readOnly) return;
    toggle(idx, drag.mode);
  };

  const stopDrag = () => setDrag(null);

  const onKey = (e: React.KeyboardEvent, day: number, row: number) => {
    if (readOnly) return;
    let { day: d, row: r } = focusRef.current;
    d = day;
    r = row;
    let handled = true;
    switch (e.key) {
      case "ArrowRight": d = Math.min(6, d + 1); break;
      case "ArrowLeft": d = Math.max(0, d - 1); break;
      case "ArrowDown": r = Math.min(SLOTS_PER_DAY - 1, r + 1); break;
      case "ArrowUp": r = Math.max(0, r - 1); break;
      case " ":
      case "Enter":
        toggle(slotIndex(day, row), "toggle");
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      focusRef.current = { day: d, row: r };
      const next = document.querySelector<HTMLButtonElement>(
        `[data-cell="${d}-${r}"]`,
      );
      next?.focus();
    }
  };

  return (
    <div onMouseUp={stopDrag} onMouseLeave={stopDrag}>
      <div
        role="grid"
        aria-label="Verfügbarkeits-Raster"
        style={{
          display: "grid",
          gridTemplateColumns: `60px repeat(7, 1fr)`,
          gap: 1,
          background: "#ddd",
          border: "1px solid #ddd",
          userSelect: "none",
          fontSize: 12,
        }}
      >
        <div style={headerCell}>Zeit</div>
        {WEEKDAYS.map((d) => (
          <div key={d} style={headerCell}>{d}</div>
        ))}

        {Array.from({ length: SLOTS_PER_DAY }).map((_, row) => (
          <Row key={row} row={row}>
            <div style={timeCell}>{slotLabel(row)}</div>
            {WEEKDAYS.map((_d, day) => {
              const idx = slotIndex(day, row);
              const on = selected.has(idx);
              return (
                <button
                  key={day}
                  data-cell={`${day}-${row}`}
                  type="button"
                  role="gridcell"
                  aria-selected={on}
                  aria-label={`${WEEKDAYS[day]} ${slotLabel(row)}`}
                  disabled={readOnly}
                  onMouseDown={(e) => { e.preventDefault(); onCellMouseDown(idx); }}
                  onMouseEnter={() => onCellMouseEnter(idx)}
                  onKeyDown={(e) => onKey(e, day, row)}
                  style={{
                    ...slotCell,
                    background: on ? "#2e7d32" : "#fff",
                    color: on ? "#fff" : "#333",
                    cursor: readOnly ? "default" : "pointer",
                  }}
                />
              );
            })}
          </Row>
        ))}
      </div>
      <p style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
        Klicken zum Setzen, ziehen zum Markieren mehrerer Slots. Pfeiltasten + Leertaste für Tastaturbedienung.
      </p>
    </div>
  );
}

function Row({ children }: { row: number; children: React.ReactNode }) {
  return <>{children}</>;
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
const slotCell: React.CSSProperties = {
  border: "none",
  height: 22,
  padding: 0,
};
