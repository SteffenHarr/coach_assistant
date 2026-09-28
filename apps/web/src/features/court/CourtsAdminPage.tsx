import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, isLoggedIn } from "../../api/client";
import { AvailabilityGrid } from "../availability/AvailabilityGrid";
import { LoginRequired, isAuthError } from "../../components/LoginRequired";
import { sortCourts } from "../../lib/sortCourts";

type Court = {
  id: string;
  name: string;
  availability: number[];
  indoor: boolean;
  priority: number;
};

const SLOTS_PER_WEEK = 7 * 48; // 30-Min-Raster, 7 Tage

function allWeekSlots(): number[] {
  return Array.from({ length: SLOTS_PER_WEEK }, (_, i) => i);
}

export function CourtsAdminPage() {
  const authed = isLoggedIn();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["courts"],
    queryFn: () => api<Court[]>("/courts"),
    enabled: authed,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Court | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!creating && !selectedId && list.data?.length) {
      setSelectedId(list.data[0]!.id);
    }
  }, [list.data, selectedId, creating]);

  useEffect(() => {
    if (creating) return;
    const c = list.data?.find((c) => c.id === selectedId) ?? null;
    setDraft(c ? structuredClone(c) : null);
  }, [selectedId, list.data, creating]);

  const create = useMutation({
    mutationFn: async (c: Court) =>
      api<Court>("/courts", {
        method: "POST",
        body: JSON.stringify({
          name: c.name,
          availability: c.availability,
          indoor: c.indoor,
          priority: c.priority,
        }),
      }),
    onSuccess: async (saved) => {
      setCreating(false);
      qc.setQueryData<Court[]>(["courts"], (old) => [...(old ?? []), saved]);
      await qc.invalidateQueries({ queryKey: ["courts"] });
      setSelectedId(saved.id);
    },
  });

  const update = useMutation({
    mutationFn: async (c: Court) =>
      api<Court>(`/courts/${c.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: c.name,
          availability: c.availability,
          indoor: c.indoor,
          priority: c.priority,
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["courts"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) =>
      api<void>(`/courts/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setSelectedId(null);
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ["courts"] });
    },
  });

  if (!authed) return <LoginRequired />;
  if (list.isLoading) return <p>lädt…</p>;
  if (list.error) {
    return isAuthError(list.error) ? (
      <LoginRequired />
    ) : (
      <p style={{ color: "var(--color-danger)" }}>{(list.error as Error).message}</p>
    );
  }

  const courts = sortCourts(list.data ?? []);
  const saving = create.isPending || update.isPending;

  return (
    <section>
      <h2>Plätze</h2>

      <div className="card" style={{ marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Halle</th>
              <th title="Solver bevorzugt bei sonst gleichwertiger Wahl den Platz mit der niedrigeren Zahl (0 = am liebsten), getrennt für Halle/Draußen.">Priorität</th>
              <th>Verfügbar (Stunden / Woche)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {courts.map((c) => (
              <tr
                key={c.id}
                style={{
                  background: c.id === selectedId && !creating ? "var(--color-primary-soft)" : undefined,
                }}
              >
                <td>{c.name}</td>
                <td>{c.indoor ? "ja" : "nein"}</td>
                <td>{c.priority}</td>
                <td>{(c.availability.length * 30) / 60}</td>
                <td className="table-actions">
                  <button
                    type="button"
                    className="btn--secondary"
                    onClick={() => {
                      setCreating(false);
                      setSelectedId(c.id);
                    }}
                  >
                    Bearbeiten
                  </button>
                  <button
                    type="button"
                    className="btn--danger"
                    onClick={() => {
                      if (confirm(`Platz "${c.name}" wirklich löschen?`)) {
                        remove.mutate(c.id);
                      }
                    }}
                    disabled={remove.isPending}
                  >
                    Löschen
                  </button>
                </td>
              </tr>
            ))}
            {courts.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: "var(--color-text-muted)" }}>
                  Noch keine Plätze angelegt.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setSelectedId(null);
              setDraft({
                id: "",
                name: "",
                availability: allWeekSlots(),
                indoor: false,
                priority: 0,
              });
            }}
          >
            + Neuer Platz
          </button>
          {remove.error && (
            <span style={{ color: "var(--color-danger)", marginLeft: 12 }}>
              Löschen fehlgeschlagen: {(remove.error as Error).message}
            </span>
          )}
        </div>
      </div>

      {draft && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24 }}>
          <div>
            <h3>
              Verfügbarkeit{" "}
              {creating ? "(neuer Platz)" : draft.name ? `– ${draft.name}` : ""}
            </h3>
            <p className="muted" style={{ fontSize: 12 }}>
              Klicke und ziehe, um Slots zu markieren (30-Min-Raster, Mo–So).
              Nur markierte Slots stehen dem Solver für diesen Platz zur
              Verfügung.
            </p>
            <AvailabilityGrid
              value={draft.availability}
              onChange={(slots) => setDraft({ ...draft, availability: slots })}
            />
          </div>
          <div>
            <h3>Stammdaten</h3>
            <div style={{ display: "grid", gap: 10 }}>
              <label>
                Name
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  style={{ width: "100%" }}
                />
              </label>
              <label className="label--inline">
                <input
                  type="checkbox"
                  checked={draft.indoor}
                  onChange={(e) => setDraft({ ...draft, indoor: e.target.checked })}
                />
                Halle (indoor)
              </label>
              <label>
                Priorität
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={draft.priority}
                  onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })}
                  style={{ width: "100%" }}
                />
                <span className="muted" style={{ fontSize: 12, display: "block", marginTop: 2 }}>
                  0 = wird bevorzugt. Nur ein weicher Tie-Breaker (getrennt für Halle/Draußen) —
                  echte Nachfrage wiegt immer schwerer.
                </span>
              </label>
            </div>

            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <button
                onClick={() => {
                  if (!draft.name.trim()) return;
                  if (creating) create.mutate(draft);
                  else update.mutate(draft);
                }}
                disabled={saving || !draft.name.trim()}
              >
                {saving ? "speichere…" : creating ? "Anlegen" : "Speichern"}
              </button>
              {creating && (
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setDraft(null);
                  }}
                >
                  Abbrechen
                </button>
              )}
            </div>
            {(create.error || update.error) && (
              <p style={{ color: "var(--color-danger)" }}>
                Speichern fehlgeschlagen:{" "}
                {((create.error || update.error) as Error).message}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
