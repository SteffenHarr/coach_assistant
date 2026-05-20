import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { AvailabilityGrid } from "../availability/AvailabilityGrid";

type ProfileResponse = {
  user: { role: string };
  coach: {
    id: string;
    name: string;
    availability: number[];
    max_group_size: number;
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
  } | null;
};

function num(s: string): number | null {
  return s === "" ? null : Number(s);
}

export function CoachProfilePage() {
  const qc = useQueryClient();
  const me = useQuery<ProfileResponse>({
    queryKey: ["me-profile"],
    queryFn: () => api<ProfileResponse>("/me/profile"),
  });

  const [name, setName] = useState("");
  const [slots, setSlots] = useState<number[]>([]);
  const [maxGroup, setMaxGroup] = useState(4);
  const [minBlock, setMinBlock] = useState(0);
  const [maxDay, setMaxDay] = useState<string>("");
  const [maxWeek, setMaxWeek] = useState<string>("");
  const [minBreak, setMinBreak] = useState(0);
  const [lkMin, setLkMin] = useState<string>("");
  const [lkMax, setLkMax] = useState<string>("");
  const [ageMin, setAgeMin] = useState<string>("");
  const [ageMax, setAgeMax] = useState<string>("");

  useEffect(() => {
    const c = me.data?.coach;
    if (!c) {
      setName(me.data?.user?.role === "coach" ? "" : "");
      return;
    }
    setName(c.name);
    setSlots(c.availability);
    setMaxGroup(c.max_group_size);
    const k = c.constraints || {};
    setMinBlock(k.min_block_slots ?? 0);
    setMaxDay(k.max_slots_per_day != null ? String(k.max_slots_per_day) : "");
    setMaxWeek(k.max_slots_per_week != null ? String(k.max_slots_per_week) : "");
    setMinBreak(k.min_break_slots ?? 0);
    setLkMin(k.accepts_lk_min != null ? String(k.accepts_lk_min) : "");
    setLkMax(k.accepts_lk_max != null ? String(k.accepts_lk_max) : "");
    setAgeMin(k.accepts_age_min != null ? String(k.accepts_age_min) : "");
    setAgeMax(k.accepts_age_max != null ? String(k.accepts_age_max) : "");
  }, [me.data]);

  const save = useMutation({
    mutationFn: () =>
      api("/me/profile/coach", {
        method: "PUT",
        body: JSON.stringify({
          name,
          availability: slots,
          max_group_size: maxGroup,
          constraints: {
            min_block_slots: minBlock,
            max_slots_per_day: num(maxDay),
            max_slots_per_week: num(maxWeek),
            min_break_slots: minBreak,
            accepts_lk_min: num(lkMin),
            accepts_lk_max: num(lkMax),
            accepts_age_min: num(ageMin),
            accepts_age_max: num(ageMax),
          },
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me-profile"] }),
  });

  if (me.isLoading) return <p>Lädt…</p>;
  if (me.data?.user.role !== "coach" && me.data?.user.role !== "admin")
    return (
      <section>
        <h2>Mein Trainer-Profil</h2>
        <p className="muted">Nur Trainer und Admins können hier Daten pflegen.</p>
      </section>
    );

  return (
    <section className="stack">
      <h2>Mein Trainer-Profil</h2>

      <div className="card">
        <h3 className="card__title">Stammdaten</h3>
        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
          <label style={{ flex: "1 1 240px" }}>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label style={{ width: 160 }}>
            Max. Gruppengröße
            <input
              type="number"
              min={1}
              max={12}
              value={maxGroup}
              onChange={(e) => setMaxGroup(Number(e.target.value))}
            />
          </label>
        </div>
      </div>

      <div className="card">
        <h3 className="card__title">Arbeitszeit-Regeln</h3>
        <p className="muted" style={{ fontSize: "var(--text-xs)" }}>
          1 Slot = 30 Minuten.
        </p>
        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
          <label style={{ width: 200 }}>
            Mindest-Block am Stück
            <input
              type="number"
              min={0}
              max={48}
              value={minBlock}
              onChange={(e) => setMinBlock(Number(e.target.value))}
            />
          </label>
          <label style={{ width: 200 }}>
            Max. Slots / Tag
            <input
              type="number"
              min={0}
              max={48}
              value={maxDay}
              onChange={(e) => setMaxDay(e.target.value)}
              placeholder="kein Limit"
            />
          </label>
          <label style={{ width: 200 }}>
            Max. Slots / Woche
            <input
              type="number"
              min={0}
              max={336}
              value={maxWeek}
              onChange={(e) => setMaxWeek(e.target.value)}
              placeholder="kein Limit"
            />
          </label>
          <label style={{ width: 200 }}>
            Mindest-Pause zwischen Blöcken
            <input
              type="number"
              min={0}
              max={48}
              value={minBreak}
              onChange={(e) => setMinBreak(Number(e.target.value))}
            />
          </label>
        </div>
      </div>

      <div className="card">
        <h3 className="card__title">Ich trainiere…</h3>
        <p className="muted" style={{ fontSize: "var(--text-xs)" }}>
          Diese Angaben sind aktuell rein informativ — der Solver berücksichtigt sie noch nicht automatisch.
        </p>
        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
          <label style={{ width: 180 }}>
            Spielstärke (LK) min.
            <input
              type="number"
              min={1}
              max={25}
              value={lkMin}
              onChange={(e) => setLkMin(e.target.value)}
              placeholder="z.B. 5"
            />
          </label>
          <label style={{ width: 180 }}>
            Spielstärke (LK) max.
            <input
              type="number"
              min={1}
              max={25}
              value={lkMax}
              onChange={(e) => setLkMax(e.target.value)}
              placeholder="z.B. 25"
            />
          </label>
          <label style={{ width: 180 }}>
            Alter min.
            <input
              type="number"
              min={3}
              max={120}
              value={ageMin}
              onChange={(e) => setAgeMin(e.target.value)}
            />
          </label>
          <label style={{ width: 180 }}>
            Alter max.
            <input
              type="number"
              min={3}
              max={120}
              value={ageMax}
              onChange={(e) => setAgeMax(e.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="card">
        <h3 className="card__title">Wann kannst du?</h3>
        <AvailabilityGrid value={slots} onChange={setSlots} />
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
