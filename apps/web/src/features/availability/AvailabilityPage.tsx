import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { AvailabilityGrid } from "./AvailabilityGrid";

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
};

type Player = {
  id: string;
  name: string;
  availability: number[];
  preferences: {
    preferred_coach_ids: string[];
    preferred_partner_ids: string[];
    allowed_session_types: string[];
  };
  min_slots_per_week: number;
  max_slots_per_week: number;
};

type Court = { id: string; name: string; availability: number[]; indoor: boolean };

type Subject = "coach" | "player" | "court";

export function AvailabilityPage() {
  const [subject, setSubject] = useState<Subject>("coach");
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: [subject + "s"],
    queryFn: async () => {
      if (subject === "coach") return api<Coach[]>("/coaches");
      if (subject === "player") return api<Player[]>("/players");
      return api<Court[]>("/courts");
    },
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const current = list.data?.find((x: any) => x.id === selectedId) ?? null;
  const [slots, setSlots] = useState<number[]>([]);

  useEffect(() => {
    setSlots(current?.availability ?? []);
  }, [current]);

  useEffect(() => {
    setSelectedId(list.data?.[0]?.id ?? null);
  }, [list.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!current) return;
      const path = `/${subject}s`;
      // Re-create (POST) by sending the full record. In a follow-up we add PATCH.
      await api(path, {
        method: "POST",
        body: JSON.stringify({
          ...current,
          availability: slots,
        }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [subject + "s"] }),
  });

  return (
    <section>
      <h2>Verfügbarkeiten</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {(["coach", "player", "court"] as Subject[]).map((s) => (
          <button
            key={s}
            onClick={() => setSubject(s)}
            style={{
              padding: "6px 12px",
              background: subject === s ? "#2e7d32" : "#eee",
              color: subject === s ? "#fff" : "#333",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            {s === "coach" ? "Trainer" : s === "player" ? "Spieler" : "Plätze"}
          </button>
        ))}
      </div>

      {list.isLoading && <p>lade...</p>}
      {list.error && <p>Bitte einloggen.</p>}
      {list.data && list.data.length === 0 && (
        <p>Noch keine Einträge angelegt.</p>
      )}

      {list.data && list.data.length > 0 && (
        <>
          <label>
            Auswahl:&nbsp;
            <select
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {list.data.map((x: any) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </select>
          </label>

          <div style={{ marginTop: 12 }}>
            <AvailabilityGrid value={slots} onChange={setSlots} />
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center" }}>
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              style={{ padding: "8px 16px" }}
            >
              {save.isPending ? "speichere..." : "Verfügbarkeit speichern"}
            </button>
            <span style={{ color: "#666" }}>
              {slots.length} Slot(s) ausgewählt ({(slots.length * 30) / 60} h/Woche)
            </span>
          </div>
        </>
      )}
    </section>
  );
}
