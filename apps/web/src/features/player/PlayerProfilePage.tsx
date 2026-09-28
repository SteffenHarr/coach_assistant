import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, isLoggedIn } from "../../api/client";
import { AvailabilityGrid } from "../availability/AvailabilityGrid";
import { NumberField } from "../../lib/NumberField";
import { LoginRequired } from "../../components/LoginRequired";
import { SLOT_MINUTES } from "../../lib/timeGrid";

const slotsToH = (s: number) => (s * SLOT_MINUTES) / 60;
const hToSlots = (h: number) => Math.round((h * 60) / SLOT_MINUTES);

function computeAge(isoDate: string): number {
  const b = new Date(isoDate);
  const today = new Date();
  let age = today.getFullYear() - b.getFullYear();
  const hadBirthdayThisYear =
    today.getMonth() > b.getMonth() || (today.getMonth() === b.getMonth() && today.getDate() >= b.getDate());
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

type Coach = { id: string; name: string };
type SessionTypePref = "single" | "double" | "group";
const SESSION_TYPE_LABEL: Record<SessionTypePref, string> = {
  single: "Einzel",
  double: "Zweier",
  group: "Gruppentraining",
};

type PlayerRecord = {
  id: string;
  name: string;
  availability: number[];
  min_slots_per_week: number;
  max_slots_per_week: number;
  preferences: {
    // Wunschtrainer / Wunsch-Mitspieler werden vom Backend bei einer
    // Spieler-Rolle entfernt. Sie sind nur für Trainer/Admins sichtbar
    // und pflegbar.
    allowed_session_types?: SessionTypePref[];
    age?: number | null;
    birth_date?: string | null;
    level_lk?: number | null;
    notes?: string;
  };
};

type ProfileResponse = {
  user: { id: string; email: string; role: string };
  coach: Coach | null;
  // Ein Konto darf mit mehreren Kindern verknüpft sein ("Familien-Account")
  // — deshalb immer eine Liste, auch wenn's meistens nur eins ist.
  players: PlayerRecord[];
};

export function PlayerProfilePage() {
  const qc = useQueryClient();
  const authed = isLoggedIn();
  const me = useQuery<ProfileResponse>({
    queryKey: ["me-profile"],
    queryFn: () => api<ProfileResponse>("/me/profile"),
    enabled: authed,
  });

  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [minSlots, setMinSlots] = useState<number | null>(2);
  const [maxSlots, setMaxSlots] = useState<number | null>(2);
  const [slots, setSlots] = useState<number[]>([]);
  const [notes, setNotes] = useState("");
  const [sessionTypes, setSessionTypes] = useState<SessionTypePref[]>(["single", "double", "group"]);
  const [conflict, setConflict] = useState<{ existing_id: string; existing_name: string } | null>(null);

  const players = me.data?.players ?? [];

  // Wählt beim Laden (oder wenn sich die Liste ändert) automatisch das
  // erste Kind aus, falls noch keins (oder ein nicht mehr existierendes)
  // ausgewählt ist.
  useEffect(() => {
    if (players.length === 0) {
      setSelectedPlayerId(null);
      return;
    }
    if (!selectedPlayerId || !players.some((p) => p.id === selectedPlayerId)) {
      setSelectedPlayerId(players[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.data]);

  useEffect(() => {
    const p = players.find((x) => x.id === selectedPlayerId) ?? null;
    if (!p) {
      setName(me.data?.user.email.split("@")[0] ?? "");
      setBirthDate("");
      setMinSlots(2);
      setMaxSlots(2);
      setSlots([]);
      setNotes("");
      setSessionTypes(["single", "double", "group"]);
      return;
    }
    setName(p.name);
    setBirthDate(p.preferences.birth_date ?? "");
    setMinSlots(p.min_slots_per_week);
    setMaxSlots(p.max_slots_per_week);
    setSlots(p.availability);
    setNotes(p.preferences.notes ?? "");
    setSessionTypes(p.preferences.allowed_session_types ?? ["single", "double", "group"]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlayerId, me.data]);

  const toggleSessionType = (t: SessionTypePref) => {
    setSessionTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
  };

  const save = useMutation({
    mutationFn: (resolve?: "take_over" | "replace") => {
      const params = new URLSearchParams();
      if (resolve) params.set("resolve", resolve);
      if (selectedPlayerId) params.set("player_id", selectedPlayerId);
      const qs = params.toString();
      return api(`/me/profile/player${qs ? `?${qs}` : ""}`, {
        method: "PUT",
        body: JSON.stringify({
          name,
          availability: slots,
          min_slots_per_week: minSlots ?? 2,
          max_slots_per_week: maxSlots ?? 2,
          preferences: {
            // preferred_coach_ids / preferred_partner_ids werden vom Backend
            // beim Spieler-Self-Edit ignoriert (nur Trainer/Admins dürfen sie
            // setzen). Wir senden sie deshalb gar nicht erst mit.
            allowed_session_types: sessionTypes,
            birth_date: birthDate || null,
            notes,
          },
        }),
      });
    },
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

  // Trainer/Admin-Accounts landen über die Navigation hier, auch wenn sie
  // gar keinen eigenen Spieler-Datensatz haben (z.B. reiner Trainer ohne
  // eigenes Kind im Verein). Ohne diese Weiche würde unten das
  // Selbst-Anlage-Formular erscheinen (Name vorausgefüllt mit dem
  // Email-Präfix) — ein Klick auf "Speichern" hätte dann einen
  // Karteileichen-Spieler angelegt. Nur für role "player" ist das
  // Anlegen eines neuen Datensatzes hier tatsächlich der Sinn der Seite.
  if (players.length === 0 && me.data?.user.role !== "player") {
    return (
      <section className="stack">
        <h2>Mein Spieler-Profil</h2>
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Mit diesem Konto ist kein Spieler-Datensatz verknüpft. Falls du zusätzlich zu deiner
            Trainer-Rolle auch ein eigenes Kind im Verein anmelden möchtest, wende dich an den Admin —
            der kann einen Spieler mit diesem Konto verknüpfen.
          </p>
        </div>
      </section>
    );
  }

  const selectedPlayer = players.find((p) => p.id === selectedPlayerId) ?? null;
  const lk = selectedPlayer?.preferences.level_lk ?? null;

  return (
    <section className="stack">
      <h2>Mein Spieler-Profil</h2>

      {players.length > 1 && (
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {players.map((p) => (
            <button
              key={p.id}
              type="button"
              className={p.id === selectedPlayerId ? "btn--toggle-active" : "btn--secondary"}
              onClick={() => setSelectedPlayerId(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      <div className="card">
        <h3 className="card__title">Stammdaten</h3>
        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
          <label style={{ flex: "1 1 240px" }}>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label style={{ width: 170 }}>
            Geburtsdatum
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
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
              value={minSlots == null ? null : slotsToH(minSlots)}
              onChange={(h) => setMinSlots(h == null ? null : hToSlots(h))}
              nullable={false}
              min={0}
              max={20}
              step={0.5}
            />
          </label>
          <label style={{ width: 160 }}>
            Stunden/Woche max.
            <NumberField
              value={maxSlots == null ? null : slotsToH(maxSlots)}
              onChange={(h) => setMaxSlots(h == null ? null : hToSlots(h))}
              nullable={false}
              min={0}
              max={20}
              step={0.5}
            />
          </label>
        </div>
        {birthDate && (
          <p className="muted" style={{ fontSize: "var(--text-xs)", margin: "var(--space-2) 0 0" }}>
            Geburtsdatum: {computeAge(birthDate)} Jahre alt
          </p>
        )}
      </div>

      <div className="card">
        <h3 className="card__title">Wann kannst du?</h3>
        <p className="muted" style={{ fontSize: "var(--text-xs)" }}>
          Klicke und ziehe, um Zeitfenster zu markieren (Mo–So).
        </p>
        <AvailabilityGrid value={slots} onChange={setSlots} />
      </div>

      <div className="card">
        <h3 className="card__title">Wie möchtest du trainieren?</h3>
        <p className="muted" style={{ fontSize: "var(--text-xs)" }}>
          Mehrfachauswahl möglich. Alle drei angehakt = keine Präferenz, der
          Solver ist bei der Gruppengröße frei.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
          {(["single", "double", "group"] as SessionTypePref[]).map((t) => {
            const on = sessionTypes.includes(t);
            return (
              <button key={t} type="button"
                className={on ? "btn--toggle-active" : "btn--secondary"}
                aria-pressed={on}
                style={{ fontSize: "var(--text-xs)", padding: "4px 10px" }}
                onClick={() => toggleSessionType(t)}
              >
                {on ? "✓ " : ""}{SESSION_TYPE_LABEL[t]}
              </button>
            );
          })}
        </div>
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

      {conflict && (
        <div className="card" style={{ borderColor: "var(--color-danger)" }}>
          <p style={{ marginTop: 0 }}>
            Es gibt bereits einen noch nicht mit einem Konto verknüpften Spieler-Datensatz
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
