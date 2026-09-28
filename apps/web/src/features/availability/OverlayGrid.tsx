import { Fragment, useMemo } from "react";
import {
  SLOTS_PER_DAY,
  WEEKDAYS,
  slotIndex,
  slotLabel,
} from "../../lib/timeGrid";

export type OverlayPerson = {
  id: string;
  name: string;
  color: string;
  slots: number[];
};

type Props = {
  people: OverlayPerson[];
};

/**
 * Read-only weekly grid that overlays several people's availability at once.
 * Every cell shows one coloured bar per person that is free in that slot, so
 * cells with many stacked colours are the times where the most people can
 * train together. A cell where *all* selected people are free is outlined.
 */
export function OverlayGrid({ people }: Props) {
  // For each slot index → the people (in stable order) that are free.
  const bySlot = useMemo(() => {
    const map = new Map<number, OverlayPerson[]>();
    for (const p of people) {
      for (const s of p.slots) {
        const arr = map.get(s);
        if (arr) arr.push(p);
        else map.set(s, [p]);
      }
    }
    return map;
  }, [people]);

  const total = people.length;

  return (
    <div style={{ overflowX: "auto" }}>
      <div
        role="grid"
        aria-label="Verfügbarkeits-Vergleich"
        className="avail-grid"
        style={{
          display: "grid",
          gridTemplateColumns: `56px repeat(7, 1fr)`,
          gap: 1,
          background: "var(--color-border)",
          minWidth: 560,
        }}
      >
        <div className="avail-header" style={{ textAlign: "right", paddingRight: "var(--space-2)" }}>Zeit</div>
        {WEEKDAYS.map((d) => (
          <div key={d} className="avail-header">{d}</div>
        ))}

        {Array.from({ length: SLOTS_PER_DAY }).map((_, row) => (
          <Fragment key={row}>
            <div className="avail-time">{slotLabel(row)}</div>
            {WEEKDAYS.map((_d, day) => {
              const idx = slotIndex(day, row);
              const here = bySlot.get(idx) ?? [];
              const all = total > 0 && here.length === total;
              return (
                <div
                  key={day}
                  role="gridcell"
                  title={
                    here.length
                      ? `${WEEKDAYS[day]} ${slotLabel(row)} — ${here.map((p) => p.name).join(", ")}`
                      : `${WEEKDAYS[day]} ${slotLabel(row)} — niemand`
                  }
                  style={{
                    display: "flex",
                    height: 18,
                    background: "var(--color-surface)",
                    outline: all ? "2px solid var(--color-text)" : "none",
                    outlineOffset: -2,
                  }}
                >
                  {here.map((p) => (
                    <div
                      key={p.id}
                      style={{ flex: 1, background: p.color, minWidth: 0 }}
                    />
                  ))}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
      <p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "var(--space-2)" }}>
        Jeder farbige Balken = eine Person ist frei · dick umrandete Felder = <strong>alle</strong> ausgewählten Personen frei
      </p>
    </div>
  );
}
