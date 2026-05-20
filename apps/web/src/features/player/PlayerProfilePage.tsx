import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { AvailabilityGrid } from "../availability/AvailabilityGrid";
import { NumberField } from "../../lib/NumberField";

type Coach = { id: string; name: string };
type Player = { id: string; name: string };

type ProfileResponse = {
  user: { id: string; email: string; role: string };
  coach: Coach | null;
  player: {
    id: string;
    name: string;
    availability: number[];
    min_slots_per_week: number;
    max_slots_per_week: number;
    preferences: {
      preferred_coach_ids?: string[];
      preferred_partner_ids?: string[];
      allowed_session_types?: string[];
      age?: number | null;
      level_lk?: number | null;
    };
  } | null;
};

export function PlayerProfilePage() {
  const qc = useQueryClient();
  const me = useQuery<ProfileResponse>({
    queryKey: ["me-profile"],
    queryFn: () => api<ProfileResponse>("/me/profile"),
  });
  const coaches = useQuery<Coach[]>({
    queryKey: ["coaches"],
    queryFn: () => api<Coach[]>("/coaches"),
  });
  const players = useQuery<Player[]>({
    queryKey: ["players"],
    queryFn: () => api<Player[]>("/players"),
  });

  const [name, setName] = useState("");
  const [age, setAge] = useState<number | null>(null);
  const [minSlots, setMinSlots] = useState<number | null>(0);
  const [maxSlots, setMaxSlots] = useState<number | null>(4);
  const [slots, setSlots] = useState<number[]>([]);
  const [coachIds, setCoachIds] = useState<string[]>([]);
  const [partnerIds, setPartnerIds] = useState<string[]>([]);

  useEffect(() => {
    const p = me.data?.player;
    if (!p) {
      setName(me.data?.user.email.split("@")[0] ?? "");
      return;
    }
    setName(p.name);
    setAge(p.preferences.age ?? null);
    setMinSlots(p.min_slots_per_week);
    setMaxSlots(p.max_slots_per_week);
    setSlots(p.availability);
    setCoachIds(p.preferences.preferred_coach_ids ?? []);
    setPartnerIds(p.preferences.preferred_partner_ids ?? []);
  }, [me.data]);

  const save = useMutation({
    mutationFn: () =>
      api("/me/profile/player", {
        method: "PUT",
        body: JSON.stringify({
          name,
          availability: slots,
          min_slots_per_week: minSlots ?? 0,
          max_slots_per_week: maxSlots ?? 0,
          preferences: {
            preferred_coach_ids: coachIds,
            preferred_partner_ids: partnerIds,
            allowed_session_types: ["single", "double", "group"],
            age,
          },
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me-profile"] }),
  });

  if (me.isLoading) return <p>Lädt…</p>;

  const lk = me.data?.player?.preferences.level_lk ?? null;

  return (
    <section className="stack">
      <h2>Mein Spieler-Profil</h2>

      <div className="card">
        <h3 className="card__title">Stammdaten</h3>
        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
          <label style={{ flex: "1 1 240px" }}>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label style={{ width: 140 }}>
            Alter
            <NumberField
              value={age}
              onChange={setAge}
              min={3}
              max={120}
              step={1}
              placeholder="—"
            />
          </label>
          <label style={{ width: 200 }}>
            Spielstärke (LK)
            <input
              type="text"
              value={lk == null ? "noch nicht eingestuft" : `LK ${lk}`}
              disabled
              title="Nur Trainer/Admin können die LK setzen"
            />
          </label>
          <label style={{ width: 160 }}>
            Stunden/Woche min.
            <NumberField
              value={minSlots}
              onChange={setMinSlots}
              nullable={false}
              min={0}
              max={20}
              step={1}
            />
          </label>
          <label style={{ width: 160 }}>
            Stunden/Woche max.
            <NumberField
              value={maxSlots}
              onChange={setMaxSlots}
              nullable={false}
              min={0}
              max={20}
              step={1}
            />
          </label>
        </div>
      </div>

      <div className="card">
        <h3 className="card__title">Wann kannst du?</h3>
        <p className="muted" style={{ fontSize: "var(--text-xs)" }}>
          Klicke und ziehe, um Zeitfenster zu markieren (Mo–So).
        </p>
        <AvailabilityGrid value={slots} onChange={setSlots} />
      </div>

      <div className="card">
        <h3 className="card__title">Wunschtrainer</h3>
        <MultiSelect
          options={(coaches.data ?? []).map((c) => ({ id: c.id, label: c.name }))}
          selected={coachIds}
          onChange={setCoachIds}
        />
      </div>

      <div className="card">
        <h3 className="card__title">Wunsch-Mitspieler</h3>
        <MultiSelect
          options={(players.data ?? [])
            .filter((p) => p.id !== me.data?.player?.id)
            .map((p) => ({ id: p.id, label: p.name }))}
          selected={partnerIds}
          onChange={setPartnerIds}
        />
      </div>

      <div className="row">
        <button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Speichert…" : "Profil speichern"}
        </button>
        {save.isSuccess && <span className="muted">Gespeichert ✓</span>}
        {save.isError && (
          <span style={{ color: "var(--color-danger)" }}>
            {(save.error as Error).message}
          </span>
        )}
      </div>
    </section>
  );
}

function MultiSelect({
  options,
  selected,
  onChange,
}: {
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  function toggle(id: string) {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  }
  if (options.length === 0)
    return <p className="muted">(noch keine Auswahl verfügbar)</p>;
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => toggle(o.id)}
            className={on ? "" : "btn--ghost"}
            style={{ padding: "4px 10px", fontSize: "var(--text-sm)" }}
          >
            {on ? "✓ " : ""}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
