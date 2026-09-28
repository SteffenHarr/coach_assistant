import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, isLoggedIn } from "../../api/client";
import { AvailabilityGrid } from "./AvailabilityGrid";
import { OverlayGrid, type OverlayPerson } from "./OverlayGrid";
import { LoginRequired, isAuthError } from "../../components/LoginRequired";
import { sortCourts } from "../../lib/sortCourts";
import { type Category, CATEGORY_LABEL, isCategoryActive, toggleCategory } from "../../lib/categories";

type Entity = {
  id: string;
  name: string;
  availability: number[];
  categories?: string[];
  indoor?: boolean;
  active?: boolean;
  preferences?: {
    age?: number | null;
    level_lk?: number | null;
  };
};

type Subject = "coach" | "player" | "court";
type Mode = "edit" | "compare";

// "coach" pluralizes irregularly (coaches, not coachs).
const subjectPath = (s: Subject) => (s === "coach" ? "coaches" : `${s}s`);

// Up to this many people can be overlaid at once so the grid stays readable.
const MAX_OVERLAY = 8;
const PALETTE = [
  "#2563eb", "#dc2626", "#16a34a", "#d97706",
  "#9333ea", "#0891b2", "#db2777", "#65a30d",
];

export function AvailabilityPage() {
  const [subject, setSubject] = useState<Subject>("coach");
  const [mode, setMode] = useState<Mode>("edit");
  const qc = useQueryClient();
  const authed = isLoggedIn();

  const list = useQuery({
    queryKey: [subject + "s"],
    queryFn: () => api<Entity[]>(`/${subjectPath(subject)}`),
    enabled: authed,
  });

  // Courts have a meaningful visual order (indoor before outdoor, "Platz 2"
  // before "Platz 10"); coaches/players are already alphabetical from the API.
  const orderedList = useMemo(
    () => (subject === "court" ? sortCourts((list.data ?? []) as (Entity & { indoor: boolean })[]) : list.data ?? []),
    [list.data, subject],
  );

  // ---- Edit mode state ----
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const current = orderedList.find((x) => x.id === selectedId) ?? null;
  const [slots, setSlots] = useState<number[]>([]);

  useEffect(() => {
    setSlots(current?.availability ?? []);
  }, [current]);

  useEffect(() => {
    setSelectedId(orderedList[0]?.id ?? null);
  }, [orderedList]);

  const save = useMutation({
    mutationFn: async () => {
      if (!current) return;
      // Narrow PATCH — touches only the availability column, never the
      // rest of the record (fixes the old POST-creates-a-duplicate bug).
      await api(`/${subjectPath(subject)}/${current.id}/availability`, {
        method: "PATCH",
        body: JSON.stringify({ availability: slots }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [subject + "s"] }),
  });

  // ---- Compare mode: filters + selection ----
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<Category[]>([]);
  const [lkMin, setLkMin] = useState<string>("");
  const [lkMax, setLkMax] = useState<string>("");
  const [ageMin, setAgeMin] = useState<string>("");
  const [ageMax, setAgeMax] = useState<string>("");
  const [indoorOnly, setIndoorOnly] = useState<"all" | "indoor" | "outdoor">("all");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("active");
  // Zeitfenster-Filter: markierte Slots im Raster -> es bleiben nur die
  // Personen übrig, die zu ALLEN markierten Zeiten können.
  const [timeFilter, setTimeFilter] = useState<number[]>([]);
  const [showTimeFilter, setShowTimeFilter] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  // Reset selection/filters when the subject changes.
  useEffect(() => {
    setPicked([]);
  }, [subject]);

  const filtered = useMemo(() => {
    const data = orderedList;
    const q = search.trim().toLowerCase();
    const lkLo = lkMin === "" ? null : Number(lkMin);
    const lkHi = lkMax === "" ? null : Number(lkMax);
    const agLo = ageMin === "" ? null : Number(ageMin);
    const agHi = ageMax === "" ? null : Number(ageMax);
    return data.filter((x) => {
      if (q && !x.name.toLowerCase().includes(q)) return false;
      // Plätze haben keinen Aktiv-Schalter, nur Trainer und Spieler.
      if (subject !== "court" && activeFilter !== "all") {
        const isActive = x.active !== false;
        if (activeFilter === "active" && !isActive) return false;
        if (activeFilter === "inactive" && isActive) return false;
      }
      if (timeFilter.length) {
        const own = new Set(x.availability);
        if (!timeFilter.every((t) => own.has(t))) return false;
      }
      if (catFilter.length) {
        const cats = (x.categories ?? []) as Category[];
        if (!catFilter.some((c) => cats.includes(c))) return false;
      }
      if (subject === "player") {
        const lk = x.preferences?.level_lk ?? null;
        if (lkLo !== null && (lk === null || lk < lkLo)) return false;
        if (lkHi !== null && (lk === null || lk > lkHi)) return false;
        const age = x.preferences?.age ?? null;
        if (agLo !== null && (age === null || age < agLo)) return false;
        if (agHi !== null && (age === null || age > agHi)) return false;
      }
      if (subject === "court" && indoorOnly !== "all") {
        if (indoorOnly === "indoor" && !x.indoor) return false;
        if (indoorOnly === "outdoor" && x.indoor) return false;
      }
      return true;
    });
  }, [orderedList, search, catFilter, lkMin, lkMax, ageMin, ageMax, indoorOnly, subject, activeFilter, timeFilter]);

  const togglePick = (id: string) => {
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      if (prev.length >= MAX_OVERLAY) return prev; // cap
      return [...prev, id];
    });
  };

  // Wichtig: gegen orderedList (ungefiltert) auflösen, nicht gegen
  // "filtered" — sonst verschwindet eine bereits ausgewählte Person aus dem
  // Vergleich, sobald man danach noch einen Filter (Kategorie, Suche, LK,
  // Alter...) anwendet, der sie aus der Auswahlliste herausfiltern würde.
  // Wer einmal für den Vergleich ausgewählt wurde, bleibt drin, bis man ihn
  // aktiv wieder abwählt oder zurücksetzt — unabhängig davon, was man
  // danach noch filtert.
  const overlayPeople: OverlayPerson[] = useMemo(() => {
    const byId = new Map(orderedList.map((x) => [x.id, x]));
    return picked
      .map((id, i) => {
        const e = byId.get(id);
        if (!e) return null;
        return { id, name: e.name, color: PALETTE[i % PALETTE.length], slots: e.availability };
      })
      .filter((x): x is OverlayPerson => x !== null);
  }, [picked, orderedList]);

  // Ausgewählte gegen die UNgefilterte Liste auflösen (in Auswahlreihenfolge,
  // damit die Farbzuordnung stabil bleibt); der Rest kommt aus der gefilterten
  // Liste ohne die bereits Ausgewählten.
  const chosenEntities = useMemo(() => {
    const byId = new Map(orderedList.map((x) => [x.id, x]));
    return picked.map((id) => byId.get(id)).filter((x): x is Entity => !!x);
  }, [picked, orderedList]);

  const restEntities = useMemo(
    () => filtered.filter((x) => !picked.includes(x.id)),
    [filtered, picked],
  );

  const toggleCat = (c: Category) => setCatFilter((prev) => toggleCategory(prev, c));

  const subjectLabel = subject === "coach" ? "Trainer" : subject === "player" ? "Spieler" : "Plätze";

  return (
    <section>
      <h2>Verfügbarkeiten</h2>

      <div className="tabs" style={{ marginBottom: "var(--space-3)" }}>
        {(["coach", "player", "court"] as Subject[]).map((s) => (
          <button
            key={s}
            onClick={() => setSubject(s)}
            className={`tab${subject === s ? " tab--active" : ""}`}
          >
            {s === "coach" ? "Trainer" : s === "player" ? "Spieler" : "Plätze"}
          </button>
        ))}
      </div>

      <div className="tabs" style={{ marginBottom: "var(--space-4)" }}>
        <button
          onClick={() => setMode("edit")}
          className={`tab${mode === "edit" ? " tab--active" : ""}`}
        >
          ✎ Bearbeiten
        </button>
        <button
          onClick={() => setMode("compare")}
          className={`tab${mode === "compare" ? " tab--active" : ""}`}
        >
          ⧉ Vergleich
        </button>
      </div>

      {!authed && <LoginRequired />}
      {list.isLoading && <p>lade...</p>}
      {list.error && (isAuthError(list.error) ? <LoginRequired /> : <p style={{ color: "var(--color-danger, crimson)" }}>{(list.error as Error).message}</p>)}
      {list.data && list.data.length === 0 && <p>Noch keine Einträge angelegt.</p>}

      {/* ---------------- EDIT MODE ---------------- */}
      {mode === "edit" && orderedList.length > 0 && (
        <>
          <label>
            Auswahl:&nbsp;
            <select value={selectedId ?? ""} onChange={(e) => setSelectedId(e.target.value)}>
              {orderedList.map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </select>
          </label>

          <div style={{ marginTop: 12 }}>
            <AvailabilityGrid value={slots} onChange={setSlots} />
          </div>

          <div className="row" style={{ marginTop: "var(--space-3)" }}>
            <button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "speichere..." : "Verfügbarkeit speichern"}
            </button>
            {save.isSuccess && <span className="pill pill--success">Gespeichert</span>}
            {save.error && <span style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)" }}>{(save.error as Error).message}</span>}
            <span className="muted" style={{ marginLeft: "auto" }}>
              {slots.length} Slot(s) · {(slots.length * 30) / 60} h/Woche
            </span>
          </div>
        </>
      )}

      {/* ---------------- COMPARE MODE ---------------- */}
      {mode === "compare" && orderedList.length > 0 && (
        <div className="card" style={{ marginBottom: "var(--space-4)" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <h3 className="card__title" style={{ margin: 0 }}>
              Nach Zeitfenster filtern
              {timeFilter.length > 0 && (
                <span className="pill pill--accent" style={{ marginLeft: "var(--space-2)" }}>
                  {timeFilter.length} Slot(s) markiert
                </span>
              )}
            </h3>
            <div className="row" style={{ gap: "var(--space-2)" }}>
              {timeFilter.length > 0 && (
                <button type="button" className="btn--ghost"
                  style={{ fontSize: "var(--text-xs)", padding: "2px 8px" }}
                  onClick={() => setTimeFilter([])}>
                  Markierung löschen
                </button>
              )}
              <button type="button"
                className={showTimeFilter ? "btn--toggle-active" : "btn--secondary"}
                style={{ fontSize: "var(--text-xs)", padding: "4px 10px" }}
                onClick={() => setShowTimeFilter((v) => !v)}>
                {showTimeFilter ? "Raster ausblenden" : "Raster einblenden"}
              </button>
            </div>
          </div>
          {showTimeFilter && (
            <>
              <p className="muted" style={{ fontSize: "var(--text-xs)" }}>
                Markiere Zeitfenster — unten bleiben nur {subjectLabel}, die zu <strong>allen</strong>{" "}
                markierten Zeiten können.
              </p>
              <AvailabilityGrid value={timeFilter} onChange={setTimeFilter} />
            </>
          )}
        </div>
      )}

      {mode === "compare" && orderedList.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "var(--space-5)", alignItems: "start" }}>
          <div className="card">
            <h3 className="card__title">Filter</h3>
            <div className="stack">
              <label>
                Suche
                <input type="text" placeholder="Name…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </label>

              {subject !== "court" && (
                <label>
                  Status
                  <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as typeof activeFilter)}>
                    <option value="active">nur aktive</option>
                    <option value="inactive">nur pausierte</option>
                    <option value="all">alle</option>
                  </select>
                </label>
              )}

              {subject !== "court" && (
                <div>
                  <label style={{ display: "block", marginBottom: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>
                    Rubrik
                  </label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
                    {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => {
                      const on = isCategoryActive(catFilter, c);
                      return (
                        <button key={c} type="button"
                          className={on ? "btn" : "btn--secondary btn"}
                          style={{ fontSize: "var(--text-xs)", padding: "4px 10px" }}
                          onClick={() => toggleCat(c)}
                        >
                          {CATEGORY_LABEL[c]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {subject === "player" && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
                    <label>
                      LK von
                      <input type="number" min={1} max={25} placeholder="1" value={lkMin} onChange={(e) => setLkMin(e.target.value)} />
                    </label>
                    <label>
                      LK bis
                      <input type="number" min={1} max={25} placeholder="25" value={lkMax} onChange={(e) => setLkMax(e.target.value)} />
                    </label>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
                    <label>
                      Alter von
                      <input type="number" min={3} max={120} placeholder="min" value={ageMin} onChange={(e) => setAgeMin(e.target.value)} />
                    </label>
                    <label>
                      Alter bis
                      <input type="number" min={3} max={120} placeholder="max" value={ageMax} onChange={(e) => setAgeMax(e.target.value)} />
                    </label>
                  </div>
                </>
              )}

              {subject === "court" && (
                <label>
                  Platztyp
                  <select value={indoorOnly} onChange={(e) => setIndoorOnly(e.target.value as any)}>
                    <option value="all">alle</option>
                    <option value="indoor">nur Halle</option>
                    <option value="outdoor">nur Außen</option>
                  </select>
                </label>
              )}

              <div className="row" style={{ justifyContent: "space-between", fontSize: "var(--text-xs)" }}>
                <span className="muted">{filtered.length} {subjectLabel} · {picked.length}/{MAX_OVERLAY} gewählt</span>
                {picked.length > 0 && (
                  <button type="button" className="btn--ghost" style={{ fontSize: "var(--text-xs)", padding: "2px 8px" }}
                    onClick={() => setPicked([])}>
                    zurücksetzen
                  </button>
                )}
              </div>
            </div>

            {/* Ausgewählte immer oben und immer sichtbar — auch wenn ein
                Filter sie gerade ausblenden würde. Sonst sieht man seine
                eigene Auswahl nicht mehr und kann sie nur noch über
                "zurücksetzen" (alle auf einmal) wieder loswerden. */}
            {chosenEntities.length > 0 && (
              <div style={{ marginTop: "var(--space-3)", display: "flex", flexDirection: "column", gap: 4 }}>
                {chosenEntities.map((x) => (
                  <PersonRow
                    key={x.id}
                    x={x}
                    colorIndex={picked.indexOf(x.id)}
                    selected
                    disabled={false}
                    subject={subject}
                    onToggle={() => togglePick(x.id)}
                  />
                ))}
                <hr style={{ border: 0, borderTop: "1px solid var(--color-border)", margin: "2px 0 0" }} />
              </div>
            )}

            <div style={{ marginTop: "var(--space-3)", maxHeight: 420, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
              {restEntities.map((x) => (
                <PersonRow
                  key={x.id}
                  x={x}
                  colorIndex={-1}
                  selected={false}
                  disabled={picked.length >= MAX_OVERLAY}
                  subject={subject}
                  onToggle={() => togglePick(x.id)}
                />
              ))}
              {restEntities.length === 0 && (
                <span className="muted" style={{ fontSize: "var(--text-xs)" }}>
                  {chosenEntities.length > 0 ? "Keine weiteren Treffer" : "Keine Treffer"}
                </span>
              )}
            </div>
          </div>

          <div className="card">
            <h3 className="card__title">Gemeinsame Verfügbarkeit</h3>
            {picked.length === 0 ? (
              <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
                Wähle links Personen aus, um zu sehen, wer wann gleichzeitig Zeit hat.
              </p>
            ) : (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)", marginBottom: "var(--space-3)" }}>
                  {overlayPeople.map((p) => (
                    <span key={p.id} className="label--inline" style={{ gap: 6, fontSize: "var(--text-xs)" }}>
                      <span style={{ width: 12, height: 12, borderRadius: 3, background: p.color, display: "inline-block" }} />
                      {p.name}
                    </span>
                  ))}
                </div>
                <OverlayGrid people={overlayPeople} />
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** Eine Zeile in der Auswahlliste des Vergleichs (Checkbox + Farbe + Name). */
function PersonRow({
  x,
  colorIndex,
  selected,
  disabled,
  subject,
  onToggle,
}: {
  x: Entity;
  colorIndex: number;
  selected: boolean;
  disabled: boolean;
  subject: Subject;
  onToggle: () => void;
}) {
  return (
    <label
      className="label--inline"
      style={{ gap: "var(--space-2)", opacity: disabled ? 0.4 : 1, cursor: disabled ? "default" : "pointer" }}
    >
      <input type="checkbox" checked={selected} disabled={disabled} onChange={onToggle} />
      <span
        style={{
          width: 12, height: 12, borderRadius: 3, flexShrink: 0,
          background: selected ? PALETTE[colorIndex % PALETTE.length] : "transparent",
          border: selected ? "none" : "1px solid var(--color-border)",
        }}
      />
      <span style={{ fontSize: "var(--text-sm)", fontWeight: selected ? 600 : 400 }}>{x.name}</span>
      {subject !== "court" && x.active === false && (
        <span className="pill pill--danger" style={{ fontSize: "var(--text-xs)" }}>pausiert</span>
      )}
      {subject === "player" && x.preferences?.level_lk != null && (
        <span className="muted" style={{ fontSize: "var(--text-xs)" }}>LK {x.preferences.level_lk}</span>
      )}
    </label>
  );
}
