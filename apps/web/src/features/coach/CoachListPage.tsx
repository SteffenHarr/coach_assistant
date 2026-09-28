import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, isLoggedIn } from "../../api/client";
import { SLOT_MINUTES } from "../../lib/timeGrid";
import { LoginRequired, isAuthError } from "../../components/LoginRequired";
import { type Category, CATEGORY_LABEL } from "../../lib/categories";

type CoachFull = {
  id: string;
  name: string;
  availability: number[];
  max_group_size: number;
  categories?: Category[];
  active?: boolean;
  constraints: {
    min_block_slots?: number;
    max_slots_per_day?: number | null;
    max_slots_per_week?: number | null;
    min_break_slots?: number;
    accepts_lk_min?: number | null;
    accepts_lk_max?: number | null;
    accepts_age_min?: number | null;
    accepts_age_max?: number | null;
  };
};

type BulkClearField = "availability" | "categories" | "constraints" | "max_group_size";
const BULK_CLEAR_FIELD_LABEL: Record<BulkClearField, string> = {
  availability: "Verfügbarkeit",
  categories: "Kategorien",
  constraints: "Constraints (Block/Pausen/Max Std/LK/Alter)",
  max_group_size: "Max. Gruppengröße",
};

function hoursOf(slots: number | null | undefined): string {
  if (slots == null) return "–";
  return ((slots * SLOT_MINUTES) / 60).toFixed(1).replace(/\.0$/, "") + " h";
}

function range(lo: number | null | undefined, hi: number | null | undefined, unit = ""): string {
  if (lo == null && hi == null) return "alle";
  if (lo == null) return `≤ ${hi}${unit}`;
  if (hi == null) return `≥ ${lo}${unit}`;
  if (lo === hi) return `${lo}${unit}`;
  return `${lo}–${hi}${unit}`;
}

export function CoachListPage() {
  const authed = isLoggedIn();
  const qc = useQueryClient();
  const meQ = useQuery<{ role: string }>({
    queryKey: ["me"],
    queryFn: () => api<{ role: string }>("/me"),
    enabled: authed,
  });
  const canEdit = ["coach", "admin", "planner"].includes(meQ.data?.role ?? "");
  // Bulk-Reset ist ein besonders folgenschweres Saisonwechsel-Werkzeug —
  // wie bei den Spielern bewusst nur für Admins sichtbar.
  const canBulkClear = meQ.data?.role === "admin";
  const coaches = useQuery<CoachFull[]>({
    queryKey: ["coaches-full"],
    queryFn: () => api<CoachFull[]>("/coaches/full"),
    enabled: authed,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clearFields, setClearFields] = useState<Set<BulkClearField>>(new Set());
  function toggleClearField(f: BulkClearField) {
    setClearFields((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f); else next.add(f);
      return next;
    });
  }

  // Pausieren statt löschen: alle Daten bleiben erhalten, der Solver
  // ignoriert den Trainer aber ab sofort bei der Plan-Erstellung.
  const mActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/coaches/${id}/active`, { method: "PATCH", body: JSON.stringify({ active }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coaches-full"] }),
  });

  // Saisonwechsel-Werkzeug: ausgewählte Datenfelder der ausgewählten
  // Trainer auf einmal auf Standard zurücksetzen. Aktiv/Inaktiv-Status
  // bleibt davon immer unberührt (siehe Backend).
  const mBulkClear = useMutation({
    mutationFn: ({ ids, fields }: { ids: string[]; fields: BulkClearField[] }) =>
      api("/coaches/bulk/clear", { method: "POST", body: JSON.stringify({ coach_ids: ids, fields }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coaches-full"] });
      setSelected(new Set());
    },
  });

  if (!authed) return <LoginRequired />;
  if (coaches.isLoading) return <p>Lädt…</p>;
  if (coaches.error)
    return isAuthError(coaches.error) ? (
      <LoginRequired />
    ) : (
      <p style={{ color: "var(--color-danger)" }}>
        {(coaches.error as Error).message}
      </p>
    );

  const list = coaches.data ?? [];
  const allVisibleSelected = list.length > 0 && list.every((c) => selected.has(c.id));
  function toggleSelectAll() {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        list.forEach((c) => next.delete(c.id));
        return next;
      }
      const next = new Set(prev);
      list.forEach((c) => next.add(c.id));
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
      `${fieldLabels} von ${ids.length} Trainer${ids.length === 1 ? "" : "n"} wirklich auf Standard zurücksetzen? Das kann nicht rückgängig gemacht werden.`,
    )) return;
    mBulkClear.mutate({ ids, fields });
  }

  return (
    <section className="stack">
      <h2>Trainer</h2>

      {canBulkClear && selected.size > 0 && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <span>{selected.size} ausgewählt — auf Standard zurücksetzen:</span>
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
              {mBulkClear.isPending ? "..." : "🗑 Ausgewählte Felder zurücksetzen"}
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

      <div className="card">
        <table>
          <thead>
            <tr>
              {canBulkClear && (
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAll}
                    title="Alle auswählen"
                  />
                </th>
              )}
              <th style={{ width: 80 }}>Aktiv</th>
              <th>Name</th>
              <th>Max. Gruppe</th>
              <th>Kategorien</th>
              <th>Akzeptiert LK</th>
              <th>Akzeptiert Alter</th>
              <th>Max./Tag</th>
              <th>Max./Woche</th>
              <th>Verfügbare Stunden</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const active = c.active !== false;
              return (
                <tr key={c.id} style={{ opacity: active ? 1 : 0.55 }}>
                  {canBulkClear && (
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleSelect(c.id)}
                      />
                    </td>
                  )}
                  <td>
                    {canEdit ? (
                      <button
                        type="button"
                        title={active ? "Aktiv — klicken zum Pausieren" : "Pausiert — klicken zum Reaktivieren"}
                        onClick={() => mActive.mutate({ id: c.id, active: !active })}
                        disabled={mActive.isPending && mActive.variables?.id === c.id}
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
                  <td>{c.name}</td>
                  <td>{c.max_group_size}</td>
                  <td>
                    {c.categories && c.categories.length > 0
                      ? c.categories.map((cat) => CATEGORY_LABEL[cat] ?? cat).join(", ")
                      : "alle"}
                  </td>
                  <td>{range(c.constraints.accepts_lk_min, c.constraints.accepts_lk_max, " LK")}</td>
                  <td>{range(c.constraints.accepts_age_min, c.constraints.accepts_age_max, "")}</td>
                  <td>{hoursOf(c.constraints.max_slots_per_day)}</td>
                  <td>{hoursOf(c.constraints.max_slots_per_week)}</td>
                  <td>{hoursOf(c.availability.length)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 && (
          <p className="muted">Noch keine Trainer angelegt.</p>
        )}
        <p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: 8 }}>
          Neue Trainer werden über <b>Benutzer-Verwaltung → Neuen Benutzer anlegen</b> mit Rolle „Trainer" hinzugefügt.
          Trainer pflegen ihre Daten unter <b>Mein Profil</b>.
        </p>
      </div>
    </section>
  );
}
