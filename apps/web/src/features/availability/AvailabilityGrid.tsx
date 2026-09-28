import { useCallback, useMemo, useRef, useState } from "react";
import {
  SLOTS_PER_DAY,
  WEEKDAYS,
  slotIndex,
  slotLabel,
} from "../../lib/timeGrid";

type Props = {
  value: number[];
  onChange: (next: number[]) => void;
  readOnly?: boolean;
};

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
      case "ArrowLeft":  d = Math.max(0, d - 1); break;
      case "ArrowDown":  r = Math.min(SLOTS_PER_DAY - 1, r + 1); break;
      case "ArrowUp":    r = Math.max(0, r - 1); break;
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
      const next = document.querySelector<HTMLButtonElement>(`[data-cell="${d}-${r}"]`);
      next?.focus();
    }
  };

  return (
    <div onMouseUp={stopDrag} onMouseLeave={stopDrag} style={{ overflowX: "auto" }}>
      <div
        role="grid"
        aria-label="Verfügbarkeits-Raster"
        className="avail-grid"
        style={{
          display: "grid",
          gridTemplateColumns: `56px repeat(7, 1fr)`,
          gap: 1,
          background: "var(--color-border)",
          userSelect: "none",
          minWidth: 480,
        }}
      >
        <div className="avail-header" style={{ textAlign: "right", paddingRight: "var(--space-2)" }}>Zeit</div>
        {WEEKDAYS.map((d) => (
          <div key={d} className="avail-header">{d}</div>
        ))}

        {Array.from({ length: SLOTS_PER_DAY }).map((_, row) => (
          <Row key={row} row={row}>
            <div className="avail-time">{slotLabel(row)}</div>
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
                  className={`avail-cell${on ? " avail-cell--on" : ""}`}
                  onMouseDown={(e) => { e.preventDefault(); onCellMouseDown(idx); }}
                  onMouseEnter={() => onCellMouseEnter(idx)}
                  onKeyDown={(e) => onKey(e, day, row)}
                />
              );
            })}
          </Row>
        ))}
      </div>
      <p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "var(--space-2)" }}>
        Klicken zum Setzen · Ziehen für mehrere Slots · Pfeiltasten + Leertaste für Tastatur
      </p>
    </div>
  );
}

function Row({ children }: { row: number; children: React.ReactNode }) {
  return <>{children}</>;
}
