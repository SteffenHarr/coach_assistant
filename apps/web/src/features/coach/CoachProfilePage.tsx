import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, isLoggedIn } from "../../api/client";
import { AvailabilityGrid } from "../availability/AvailabilityGrid";
import { NumberField } from "../../lib/NumberField";
import { SLOT_MINUTES } from "../../lib/timeGrid";
import { LoginRequired } from "../../components/LoginRequired";

type ProfileResponse = {
  user: { role: string; email: string };
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
      max_break_slots?: number | null;
      accepts_lk_min?: number | null;
      accepts_lk_max?: number | null;
      accepts_age_min?: number | null;
      accepts_age_max?: number | null;
    };
  } | null;
};

const slotsForHours = (h: number | null) =>
  h == null ? null : Math.max(0, Math.round((h * 60) / SLOT_MINUTES));
const hoursForSlots = (s: number | null | undefined): number | null =>
  s == null ? null : (s * SLOT_MINUTES) / 60;

export function CoachProfilePage() {
  const qc = useQueryClient();
  const authed = isLoggedIn();
  const me = useQuery<ProfileResponse>({
    queryKey: ["me-profile"],
    queryFn: () => api<ProfileResponse>("/me/profile"),
    enabled: authed,
  });

  const [name, setName] = useState("");
  const [slots, setSlots] = useState<number[]>([]);
  const [maxGroup, setMaxGroup] = useState<number | null>(4);
  const [minBlockH, setMinBlockH] = useState<number | null>(0);
  const [maxDayH, setMaxDayH] = useState<number | null>(null);
  const [maxWeekH, setMaxWeekH] = useState<number | null>(null);
  const [minBreakH, setMinBreakH] = useState<number | null>(0);
  const [maxBreakH, setMaxBreakH] = useState<number | null>(null);
  const [lkMin, setLkMin] = useState<number | null>(null);
  const [lkMax, setLkMax] = useState<number | null>(null);
  const [ageMin, setAgeMin] = useState<number | null>(null);
  const [ageMax, setAgeMax] = useState<number | null>(null);
  const [conflict, setConflict] = useState<{ existing_id: string; existing_name: string } | null>(null);

  useEffect(() => {
    const c = me.data?.coach;
    if (!c) {
      // No coach record yet — gets created on first save.
      setName(me.data?.user.email?.split("@")[0] ?? "");
      setSlots([]);
      setMaxGroup(4);
      setMinBlockH(0);
      setMaxDayH(null);
      setMaxWeekH(null);
      setMinBreakH(0);
      setMaxBreakH(null);
      setLkMin(null);
      setLkMax(null);
      setAgeMin(null);
      setAgeMax(null);
      return;
    }
    setName(c.name);
    setSlots(c.availability);
    setMaxGroup(c.max_group_size);
    const k = c.constraints || {};
    setMinBlockH(hoursForSlots(k.min_block_slots ?? 0) ?? 0);
    setMaxDayH(hoursForSlots(k.max_slots_per_day ?? null));
    setMaxWeekH(hoursForSlots(k.max_slots_per_week ?? null));
    setMinBreakH(hoursForSlots(k.min_break_slots ?? 0) ?? 0);
    setMaxBreakH(hoursForSlots(k.max_break_slots ?? null));
    setLkMin(k.accepts_lk_min ?? null);
    setLkMax(k.accepts_lk_max ?? null);
    setAgeMin(k.accepts_age_min ?? null);
    setAgeMax(k.accepts_age_max ?? null);
  }, [me.data]);

  const save = useMutation({
    mutationFn: (resolve?: "take_over" | "replace") =>
      api(`/me/profile/coach${resolve ? `?resolve=${resolve}` : ""}`, {
        method: "PUT",
        body: JSON.stringify({
          name,
          availability: slots,
          max_group_size: maxGroup ?? 4,
          constraints: {
            min_block_slots: slotsForHours(minBlockH ?? 0) ?? 0,
            max_slots_per_day: slotsForHours(maxDayH),
            max_slots_per_week: slotsForHours(maxWeekH),
            min_break_slots: slotsForHours(minBreakH ?? 0) ?? 0,
            max_break_slots: slotsForHours(maxBreakH),
            accepts_lk_min: lkMin,
            accepts_lk_max: lkMax,
            accepts_age_min: ageMin,
            accepts_age_max: ageMax,
          },
        }),
      }),
    onSuccess: () => {
      setConflict(null);
      qc.invalidateQueries({ queryKey: ["me-profile"] });
    },
    onError: (e: any) => {
      if (e?.status === 409 && e?.body?.detail?.existing_id) {
        setConflict(e.body.detail);
      } else {
        setConflict(null);
      }
    },
  });

  if (!authed) return <LoginRequired />;
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
          <label style={{ width: 180 }}>
            Max. Gruppengröße
            <NumberField
              value={maxGroup}
              onChange={setMaxGroup}
              nullable={false}
              min={1}
              max={12}
              step={1}
            />
          </label>
        </div>
      </div>

      <div className="card">
        <h3 className="card__title">Arbeitszeit-Regeln</h3>
        <p className="muted" style={{ fontSize: "var(--text-xs)" }}>
          Angaben in Stunden. Felder leer lassen heißt „keine Einschränkung".
        </p>
        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
          <label style={{ width: 220 }}>
            Mindest-Block am Stück (h)
            <NumberField
              value={minBlockH}
              onChange={setMinBlockH}
              nullable={false}
              min={0}
              max={24}
              step={0.5}
            />
          </label>
          <label style={{ width: 220 }}>
            Max. Stunden / Tag
            <NumberField
              value={maxDayH}
              onChange={setMaxDayH}
              min={0}
              max={24}
              step={0.5}
              placeholder="kein Limit"
            />
          </label>
          <label style={{ width: 220 }}>
            Max. Stunden / Woche
            <NumberField
              value={maxWeekH}
              onChange={setMaxWeekH}
              min={0}
              max={168}
              step={0.5}
              placeholder="kein Limit"
            />
          </label>
          <label style={{ width: 220 }}>
            Mindest-Pause zwischen Blöcken (h)
            <NumberField
              value={minBreakH}
              onChange={setMinBreakH}
              nullable={false}
              min={0}
              max={24}
              step={0.5}
            />
          </label>
          <label style={{ width: 220 }}>
            Max. Pause zwischen Blöcken (h)
            <NumberField
              value={maxBreakH}
              onChange={setMaxBreakH}
              min={0}
              max={24}
              step={0.5}
              placeholder="kein Limit"
            />
            <span
              className="muted"
              style={{ fontSize: "var(--text-xs)", display: "block" }}
            >
              0 = Stunden müssen direkt aneinander anschließen, leer = kein
              Limit
            </span>
          </label>
        </div>
      </div>

      <div className="card">
        <h3 className="card__title">Ich trainiere…</h3>
        <p className="muted" style={{ fontSize: "var(--text-xs)" }}>
          Der Solver berücksichtigt diese Werte als harte Einschränkungen.
          Felder leer lassen heißt „keine Einschränkung".
        </p>
        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
          <label style={{ width: 200 }}>
            Spielstärke (LK) min.
            <NumberField
              value={lkMin}
              onChange={setLkMin}
              min={1}
              max={25}
              step={1}
              placeholder="z.B. 1"
            />
          </label>
          <label style={{ width: 200 }}>
            Spielstärke (LK) max.
            <NumberField
              value={lkMax}
              onChange={setLkMax}
              min={1}
              max={25}
              step={1}
              placeholder="z.B. 25"
            />
          </label>
          <label style={{ width: 200 }}>
            Alter min.
            <NumberField
              value={ageMin}
              onChange={setAgeMin}
              min={3}
              max={120}
              step={1}
              placeholder="kein Limit"
            />
          </label>
          <label style={{ width: 200 }}>
            Alter max.
            <NumberField
              value={ageMax}
              onChange={setAgeMax}
              min={3}
              max={120}
              step={1}
              placeholder="kein Limit"
            />
          </label>
        </div>
      </div>

      <div className="card">
        <h3 className="card__title">Wann kannst du?</h3>
        <AvailabilityGrid value={slots} onChange={setSlots} />
      </div>

      {conflict && (
        <div className="card" style={{ borderColor: "var(--color-danger)" }}>
          <p style={{ marginTop: 0 }}>
            Es gibt bereits einen noch nicht mit einem Konto verknüpften Trainer-Datensatz
            namens <strong>„{conflict.existing_name}"</strong>. Bist du das?
          </p>
          <div className="row">
            <button onClick={() => save.mutate("take_over")} disabled={save.isPending}>
              Ja, das bin ich — übernehmen
            </button>
            <button
              className="btn--danger"
              disabled={save.isPending}
              onClick={() => {
                if (window.confirm(`„${conflict.existing_name}" wirklich löschen und einen neuen Datensatz für dich anlegen?`)) {
                  save.mutate("replace");
                }
              }}
            >
              Nein — alten löschen, neu anlegen
            </button>
            <button className="btn--ghost" disabled={save.isPending} onClick={() => setConflict(null)}>
              Abbrechen
            </button>
          </div>
        </div>
      )}

      <div className="row">
        <button onClick={() => save.mutate(undefined)} disabled={save.isPending}>
          {save.isPending ? "Speichert…" : "Profil speichern"}
        </button>
        {save.isSuccess && <span className="muted">Gespeichert ✓</span>}
        {save.isError && !conflict && (
          <span style={{ color: "var(--color-danger)" }}>
            {(save.error as Error).message}
          </span>
        )}
      </div>
    </section>
  );
}
