import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, isLoggedIn } from "../../api/client";
import { AvailabilityGrid } from "../availability/AvailabilityGrid";
import { SLOT_MINUTES } from "../../lib/timeGrid";
import { LoginRequired, isAuthError } from "../../components/LoginRequired";

type Category = "kids" | "youth" | "adults" | "team" | "open";
const CATEGORY_LABEL: Record<Category, string> = {
  kids: "Kinder",
  youth: "Jugend",
  adults: "Erwachsene",
  team: "Mannschaft",
  open: "frei (alle)",
};

type Coach = {
  id: string;
  name: string;
  availability: number[];
  constraints: {
    min_block_slots: number;
    max_slots_per_day: number | null;
    max_slots_per_week: number | null;
    min_break_slots: number;
  };
  max_group_size: number;
  categories?: Category[];
};

const slotsForHours = (h: number) => Math.round((h * 60) / SLOT_MINUTES);
const hoursForSlots = (s: number | null) => (s == null ? "" : s * SLOT_MINUTES / 60);

export function CoachEditorPage() {
  const qc = useQueryClient();
  const authed = isLoggedIn();
  const list = useQuery({ queryKey: ["coaches"], queryFn: () => api<Coach[]>("/coaches"), enabled: authed });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Coach | null>(null);

  useEffect(() => {
    if (!selectedId && list.data?.length) setSelectedId(list.data[0].id);
  }, [list.data, selectedId]);

  useEffect(() => {
    const c = list.data?.find((c) => c.id === selectedId) ?? null;
    setDraft(c ? structuredClone(c) : null);
  }, [selectedId, list.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      await api("/coaches", { method: "POST", body: JSON.stringify(draft) });
      // Kategorien laufen über einen separaten Endpoint (PATCH), da das
      // POST-/coaches-Schema die Liste sonst stillschweigend auf die
      // Default-Werte zurücksetzen würde, wenn das Frontend kein
      // categories-Feld mitschickt.
      await api(`/coaches/${draft.id}/categories`, {
        method: "PATCH",
        body: JSON.stringify({ categories: draft.categories ?? [] }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coaches"] }),
  });

  return (
    <section>
      <h2>Trainer & Constraints</h2>
      {!authed && <LoginRequired />}
      {list.isLoading && <p>lade...</p>}
      {list.error && (isAuthError(list.error) ? <LoginRequired /> : <p style={{ color: "var(--color-danger, crimson)" }}>{(list.error as Error).message}</p>)}
      {list.data && (
        <label>
          Trainer:&nbsp;
          <select value={selectedId ?? ""} onChange={(e) => setSelectedId(e.target.value)}>
            {list.data.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      )}

      {draft && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24, marginTop: 16 }}>
          <div>
            <h3>Verfügbarkeit</h3>
            <AvailabilityGrid
              value={draft.availability}
              onChange={(slots) => setDraft({ ...draft, availability: slots })}
            />
          </div>

          <div>
            <h3>Constraints</h3>
            <div style={{ display: "grid", gap: 10 }}>
              <NumField
                label="Mindest-Block (Stunden am Stück)"
                value={hoursForSlots(draft.constraints.min_block_slots)}
                onChange={(h) =>
                  setDraft({
                    ...draft,
                    constraints: { ...draft.constraints, min_block_slots: slotsForHours(Number(h) || 0) },
                  })
                }
                step={0.5}
              />
              <NumField
                label="Max Stunden pro Tag"
                value={hoursForSlots(draft.constraints.max_slots_per_day)}
                allowEmpty
                onChange={(h) =>
                  setDraft({
                    ...draft,
                    constraints: {
                      ...draft.constraints,
                      max_slots_per_day: h === "" ? null : slotsForHours(Number(h)),
                    },
                  })
                }
                step={0.5}
              />
              <NumField
                label="Max Stunden pro Woche"
                value={hoursForSlots(draft.constraints.max_slots_per_week)}
                allowEmpty
                onChange={(h) =>
                  setDraft({
                    ...draft,
                    constraints: {
                      ...draft.constraints,
                      max_slots_per_week: h === "" ? null : slotsForHours(Number(h)),
                    },
                  })
                }
                step={0.5}
              />
              <NumField
                label="Mindest-Pause zwischen Blöcken (Stunden)"
                value={hoursForSlots(draft.constraints.min_break_slots)}
                onChange={(h) =>
                  setDraft({
                    ...draft,
                    constraints: { ...draft.constraints, min_break_slots: slotsForHours(Number(h) || 0) },
                  })
                }
                step={0.5}
              />
              <NumField
                label="Max Gruppengröße"
                value={draft.max_group_size}
                onChange={(v) => setDraft({ ...draft, max_group_size: Math.max(1, Number(v) || 1) })}
                step={1}
              />

              <div>
                <label style={{ display: "block", marginBottom: 6 }}>
                  Trainings-Kategorien (hartes Filterkriterium)
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(Object.keys(CATEGORY_LABEL) as Category[]).map((cat) => {
                    const on = (draft.categories ?? []).includes(cat);
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => {
                          const cur = draft.categories ?? [];
                          const next = on
                            ? cur.filter((c) => c !== cat)
                            : [...cur, cat];
                          setDraft({ ...draft, categories: next });
                        }}
                        style={{
                          padding: "4px 10px",
                          fontSize: 13,
                          border: "1px solid #aaa",
                          borderRadius: 4,
                          background: on ? "#1976d2" : "#fff",
                          color: on ? "#fff" : "#333",
                          cursor: "pointer",
                        }}
                      >
                        {on ? "✓ " : ""}
                        {CATEGORY_LABEL[cat]}
                      </button>
                    );
                  })}
                </div>
                <p style={{ fontSize: 11, color: "#666", margin: "4px 0 0" }}>
                  Leere Auswahl oder "frei" = nimmt jeden Spieler. Sonst nur
                  Spieler mit passender Kategorie.
                </p>
              </div>
            </div>

            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              style={{ marginTop: 16, padding: "8px 16px" }}
            >
              {save.isPending ? "speichere..." : "Speichern"}
            </button>
            {save.error && <p style={{ color: "crimson" }}>Speichern fehlgeschlagen.</p>}
          </div>
        </div>
      )}
    </section>
  );
}

function NumField({
  label,
  value,
  onChange,
  step,
  allowEmpty,
}: {
  label: string;
  value: number | string;
  onChange: (v: string) => void;
  step: number;
  allowEmpty?: boolean;
}) {
  return (
    <label style={{ display: "grid", gap: 2 }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      <input
        type="number"
        min={0}
        step={step}
        value={value === "" ? "" : value}
        placeholder={allowEmpty ? "(unbegrenzt)" : ""}
        onChange={(e) => onChange(e.target.value)}
        style={{ padding: 6 }}
      />
    </label>
  );
}
