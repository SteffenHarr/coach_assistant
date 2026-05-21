import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, isLoggedIn } from "../../api/client";
import { AvailabilityGrid } from "../availability/AvailabilityGrid";
import { LoginRequired, isAuthError } from "../../components/LoginRequired";

type Court = {
  id: string;
  name: string;
  availability: number[];
  indoor: boolean;
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
        }),
      }),
    onSuccess: async (saved) => {
      setCreating(false);
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
      <p style={{ color: "crimson" }}>{(list.error as Error).message}</p>
    );
  }

  const courts = list.data ?? [];
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
              <th>Verfügbar (Stunden / Woche)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {courts.map((c) => (
              <tr
                key={c.id}
                style={{
                  background: c.id === selectedId && !creating ? "#eef" : undefined,
                }}
              >
                <td>{c.name}</td>
                <td>{c.indoor ? "ja" : "nein"}</td>
                <td>{(c.availability.length * 30) / 60}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(false);
                      setSelectedId(c.id);
                    }}
                  >
                    Bearbeiten
                  </button>
                  &nbsp;
                  <button
                    type="button"
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
                <td colSpan={4} style={{ color: "#666" }}>
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
              });
            }}
          >
            + Neuer Platz
          </button>
          {remove.error && (
            <span style={{ color: "crimson", marginLeft: 12 }}>
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
                Name<br />
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  style={{ width: "100%" }}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.indoor}
                  onChange={(e) => setDraft({ ...draft, indoor: e.target.checked })}
                />
                &nbsp;Halle (indoor)
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
              <p style={{ color: "crimson" }}>
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
