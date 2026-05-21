import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, isLoggedIn } from "../../api/client";
import { AvailabilityGrid } from "../availability/AvailabilityGrid";
import { NumberField } from "../../lib/NumberField";
import { LoginRequired } from "../../components/LoginRequired";

type Coach = { id: string; name: string };

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
      // Wunschtrainer / Wunsch-Mitspieler werden vom Backend bei einer
      // Spieler-Rolle entfernt. Sie sind nur für Trainer/Admins sichtbar
      // und pflegbar.
      allowed_session_types?: string[];
      age?: number | null;
      level_lk?: number | null;
      notes?: string;
    };
  } | null;
};

export function PlayerProfilePage() {
  const qc = useQueryClient();
  const authed = isLoggedIn();
  const me = useQuery<ProfileResponse>({
    queryKey: ["me-profile"],
    queryFn: () => api<ProfileResponse>("/me/profile"),
    enabled: authed,
  });

  const [name, setName] = useState("");
  const [age, setAge] = useState<number | null>(null);
  const [minSlots, setMinSlots] = useState<number | null>(0);
  const [maxSlots, setMaxSlots] = useState<number | null>(4);
  const [slots, setSlots] = useState<number[]>([]);
  const [notes, setNotes] = useState("");

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
    setNotes(p.preferences.notes ?? "");
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
            // preferred_coach_ids / preferred_partner_ids werden vom Backend
            // beim Spieler-Self-Edit ignoriert (nur Trainer/Admins dürfen sie
            // setzen). Wir senden sie deshalb gar nicht erst mit.
            allowed_session_types: ["single", "double", "group"],
            age,
            notes,
          },
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me-profile"] }),
  });

  if (!authed) return <LoginRequired />;
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
        <h3 className="card__title">Bemerkungen für die Trainer</h3>
        <p className="muted" style={{ fontSize: "var(--text-xs)" }}>
          Hier kannst du Wünsche und Hinweise eintragen, z.B. bevorzugte
          Trainer oder Mitspieler, Verletzungen, Ziele… Die Trainer lesen
          das und entscheiden, was im Plan berücksichtigt wird.
        </p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={5}
          maxLength={2000}
          style={{ width: "100%", fontFamily: "inherit" }}
          placeholder="z.B. Trainiere am liebsten mit Max und Anna. Mittwochs nur ab 18 Uhr möglich. Aktuell Schulter-Reha."
        />
        <span
          className="muted"
          style={{ fontSize: "var(--text-xs)", display: "block" }}
        >
          {notes.length} / 2000 Zeichen
        </span>
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
