import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, isLoggedIn } from "../../api/client";
import { AvailabilityGrid } from "../availability/AvailabilityGrid";
import { SLOT_MINUTES } from "../../lib/timeGrid";
import { LoginRequired, isAuthError } from "../../components/LoginRequired";
import { type Category, CATEGORY_LABEL, isCategoryActive, toggleCategory } from "../../lib/categories";
import { NumberField } from "../../lib/NumberField";
import { PasswordField } from "../../lib/PasswordField";
import { setNavigationGuard } from "../../lib/unsavedChanges";

function computeAge(isoDate: string): number {
  const b = new Date(isoDate);
  const today = new Date();
  let age = today.getFullYear() - b.getFullYear();
  const hadBirthdayThisYear =
    today.getMonth() > b.getMonth() || (today.getMonth() === b.getMonth() && today.getDate() >= b.getDate());
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

type Mate = { player_id: string; mandatory: boolean };
type SessionTypePref = "single" | "double" | "group";
const SESSION_TYPE_LABEL: Record<SessionTypePref, string> = {
  single: "Einzel",
  double: "Zweier",
  group: "Gruppentraining",
};

type Player = {
  id: string;
  name: string;
  availability: number[];
  categories?: string[];
  preferences: {
    allowed_session_types?: SessionTypePref[];
    age?: number | null;
    birth_date?: string | null;
    level_lk?: number | null;
    notes?: string;
    categories?: string[];
  };
  min_slots_per_week: number;
  max_slots_per_week: number;
  mates?: Mate[];
  has_account?: boolean;
};

const slotsToH = (s: number) => (s * SLOT_MINUTES) / 60;
const hToSlots = (h: number) => Math.round((h * 60) / SLOT_MINUTES);

export function PlayerEditorPage() {
  const qc = useQueryClient();
  const authed = isLoggedIn();
  const list = useQuery({
    queryKey: ["players"],
    queryFn: () => api<Player[]>("/players"),
    enabled: authed,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Player | null>(null);
  const [newName, setNewName] = useState("");
  const [acctEmail, setAcctEmail] = useState("");
  const [acctPw, setAcctPw] = useState("");
  const [showAcct, setShowAcct] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [linkEmail, setLinkEmail] = useState("");
  const [mates, setMates] = useState<Mate[]>([]);
  const [mateFilter, setMateFilter] = useState("");
  const [playerSearch, setPlayerSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!selectedId && list.data?.length) setSelectedId(list.data[0].id);
  }, [list.data, selectedId]);

  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    const p = list.data?.find((p) => p.id === selectedId) ?? null;

    if (selectedId !== activeIdRef.current) {
      // Player switched: full reset
      activeIdRef.current = selectedId;
      if (p) {
        setDraft(structuredClone({
          ...p,
          preferences: { ...p.preferences, categories: p.categories ?? p.preferences.categories ?? [] },
        }));
        setMates(p.mates ?? []);
      } else {
        setDraft(null);
        setMates([]);
      }
      setShowAcct(false);
      setAcctEmail("");
      setAcctPw("");
      setShowLink(false);
      setLinkEmail("");
      setDirty(false);
    }
  }, [selectedId, list.data]);

  function confirmDiscardIfDirty(): boolean {
    return !dirty || window.confirm("Du hast ungespeicherte Änderungen im Spielerprofil. Trotzdem fortfahren und Änderungen verwerfen?");
  }

  // Warn before closing the tab / navigating away via the address bar if
  // there are edits that were never sent via "Speichern".
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Same warning for in-app navigation (nav menu, subnav tabs, top bar
  // links) — see lib/unsavedChanges.ts for why this can't just be
  // useBlocker (no data router here).
  useEffect(() => {
    setNavigationGuard(dirty ? confirmDiscardIfDirty : null);
    return () => setNavigationGuard(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  function selectPlayer(id: string) {
    if (!confirmDiscardIfDirty()) return;
    setSelectedId(id);
  }

  const pref = draft?.preferences ?? {};
  const cats: Category[] = (pref.categories ?? []) as Category[];

  const createPlayer = useMutation({
    mutationFn: () => api<Player>("/players/quick", { method: "POST", body: JSON.stringify({ name: newName.trim() }) }),
    onSuccess: (p) => {
      // Synchronously add to cache so the useEffect finds the player before the refetch completes
      qc.setQueryData<Player[]>(["players"], (old) => [...(old ?? []), p]);
      qc.invalidateQueries({ queryKey: ["players"] });
      setSelectedId(p.id);
      setNewName("");
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      await api(`/players/${draft.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: draft.name,
          availability: draft.availability,
          preferences: { ...draft.preferences, categories: cats },
          min_slots_per_week: draft.min_slots_per_week,
          max_slots_per_week: draft.max_slots_per_week,
          mates,
          categories: cats,
        }),
      });
    },
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["players"] });
    },
  });

  const deletePlayer = useMutation({
    mutationFn: () => api(`/players/${draft!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.setQueryData<Player[]>(["players"], (old) => old?.filter(p => p.id !== draft!.id) ?? []);
      qc.invalidateQueries({ queryKey: ["players"] });
      setSelectedId(null);
      activeIdRef.current = null;
    },
  });

  const createAccount = useMutation({
    mutationFn: () => api(`/players/${draft!.id}/account`, {
      method: "POST",
      body: JSON.stringify({ email: acctEmail, password: acctPw }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["players"] });
      qc.invalidateQueries({ queryKey: ["users"] });
      setShowAcct(false);
    },
  });

  const linkAccount = useMutation({
    mutationFn: () => api(`/players/${draft!.id}/link-account`, {
      method: "PATCH",
      body: JSON.stringify({ email: linkEmail }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["players"] });
      qc.invalidateQueries({ queryKey: ["users"] });
      setShowLink(false);
      setLinkEmail("");
    },
  });

  const setField = (key: keyof Player, val: any) => {
    setDraft((d) => d ? { ...d, [key]: val } : d);
    setDirty(true);
  };
  const setPref = (key: string, val: any) => {
    setDraft((d) => d ? { ...d, preferences: { ...d.preferences, [key]: val } } : d);
    setDirty(true);
  };
  const toggleSessionType = (t: SessionTypePref) => {
    const current = pref.allowed_session_types ?? ["single", "double", "group"];
    const next = current.includes(t) ? current.filter((x) => x !== t) : [...current, t];
    setPref("allowed_session_types", next);
  };

  // Mates leben nur lokal, bis auf "Speichern" geklickt wird — sie gehen als
  // Teil des ganzen Entwurfs mit raus (siehe ``save`` oben), statt sich
  // sofort selbst zu speichern.
  const toggleMate = (pid: string) => {
    setMates((ms) => {
      const exists = ms.find(m => m.player_id === pid);
      return exists ? ms.filter(m => m.player_id !== pid) : [...ms, { player_id: pid, mandatory: false }];
    });
    setDirty(true);
  };
  const setMandatory = (pid: string, mandatory: boolean) => {
    setMates((ms) => ms.map(m => m.player_id === pid ? { ...m, mandatory } : m));
    setDirty(true);
  };

  const others = (list.data ?? []).filter(p => p.id !== selectedId);
  const selectedPlayerName = list.data?.find(p => p.id === selectedId)?.name ?? null;

  return (
    <section>
      <h2>Spieler-Daten</h2>
      {!authed && <LoginRequired />}
      {list.isLoading && <p>lade...</p>}
      {list.error && (isAuthError(list.error) ? <LoginRequired /> : (
        <p style={{ color: "var(--color-danger)" }}>{(list.error as Error).message}</p>
      ))}

      {/* Quick create */}
      <div className="card" style={{ marginBottom: "var(--space-4)" }}>
        <h3 className="card__title">Neuen Spieler anlegen</h3>
        <div className="row">
          <input
            type="text"
            placeholder="Name des Spielers"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && newName.trim() && confirmDiscardIfDirty() && createPlayer.mutate()}
            style={{ flex: 1 }}
          />
          <button
            onClick={() => confirmDiscardIfDirty() && createPlayer.mutate()}
            disabled={!newName.trim() || createPlayer.isPending}
          >
            {createPlayer.isPending ? "..." : "Anlegen"}
          </button>
        </div>
        {createPlayer.error && (
          <p style={{ color: "var(--color-danger)", margin: "var(--space-2) 0 0", fontSize: "var(--text-sm)" }}>
            {(createPlayer.error as Error).message}
          </p>
        )}
      </div>

      {/* Player selector — autocomplete: suggestions float over the page
          and only appear while actively searching, instead of a native
          <select> (needs an extra click to open) or a permanent list box
          (takes up space even when not searching). */}
      {list.data && list.data.length > 0 && (
        <div style={{ marginBottom: "var(--space-4)", maxWidth: 700 }}>
          <label style={{ display: "flex", width: "100%" }}>
            Spieler suchen/bearbeiten
            <div style={{ position: "relative", width: "100%" }}>
              {!searchFocused ? (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setSearchFocused(true)}
                  onKeyDown={(e) => e.key === "Enter" && setSearchFocused(true)}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-surface)",
                    cursor: "text",
                    fontSize: "var(--text-md)",
                    boxSizing: "border-box",
                  }}
                >
                  <strong>{selectedPlayerName ?? "Spieler auswählen"}</strong>
                  <span style={{ color: "var(--color-text-soft)" }}> – Klicke hier, um nach einem anderen Spieler zu suchen.</span>
                </div>
              ) : (
                <input
                  type="text"
                  autoFocus
                  placeholder={`Suche unter ${list.data.length} Spielern…`}
                  value={playerSearch}
                  onChange={(e) => setPlayerSearch(e.target.value)}
                  onBlur={() => setTimeout(() => { setSearchFocused(false); setPlayerSearch(""); }, 150)}
                  style={{ fontSize: "var(--text-md)", width: "100%", boxSizing: "border-box" }}
                />
              )}
              {searchFocused && playerSearch.trim() && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    zIndex: 20,
                    maxHeight: 260,
                    overflowY: "auto",
                    marginTop: 4,
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-md)",
                    boxShadow: "var(--shadow-lg)",
                  }}
                >
                  {list.data
                    .filter((p) => p.name.toLowerCase().includes(playerSearch.trim().toLowerCase()))
                    .map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => { selectPlayer(p.id); setPlayerSearch(""); }}
                        className={p.id === selectedId ? "btn" : "btn--ghost"}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          borderRadius: 0,
                          padding: "7px 10px",
                          fontSize: "var(--text-sm)",
                        }}
                      >
                        {p.name}{p.has_account ? "" : " (kein Konto)"}
                      </button>
                    ))}
                  {list.data.filter((p) => p.name.toLowerCase().includes(playerSearch.trim().toLowerCase())).length === 0 && (
                    <p className="muted" style={{ margin: 0, padding: "var(--space-2) var(--space-3)", fontSize: "var(--text-sm)" }}>
                      Keine Spieler gefunden.
                    </p>
                  )}
                </div>
              )}
            </div>
          </label>
        </div>
      )}

      {draft && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "var(--space-5)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <div className="card">
              <h3 className="card__title">Verfügbarkeit</h3>
              <AvailabilityGrid
                value={draft.availability}
                onChange={(slots) => setField("availability", slots)}
              />
            </div>

            {/* Spielpartner */}
            <div className="card">
              <h3 className="card__title">
                Spielpartner
                {mates.length > 0 && <span className="pill pill--accent" style={{ marginLeft: 8 }}>{mates.length} ausgewählt</span>}
              </h3>
              <p className="muted" style={{ fontSize: "var(--text-xs)", margin: "0 0 var(--space-3)" }}>
                Ausgewählt = Solver versucht Zusammenlegung · Pflicht = müssen immer gemeinsam trainieren
              </p>
              {others.length > 8 && (
                <input
                  type="text"
                  placeholder="Spieler suchen…"
                  value={mateFilter}
                  onChange={(e) => setMateFilter(e.target.value)}
                  style={{ marginBottom: "var(--space-3)" }}
                />
              )}
              {(() => {
                // Spaltenweise gefüllt (column-major) statt zeilenweise,
                // damit man pro Spalte alphabetisch von oben nach unten
                // lesen kann.
                const filteredOthers = others
                  .filter(q => q.name.toLowerCase().includes(mateFilter.trim().toLowerCase()))
                  .sort((a, b) => {
                    const ma = mates.some(x => x.player_id === a.id);
                    const mb = mates.some(x => x.player_id === b.id);
                    if (ma !== mb) return ma ? -1 : 1;
                    return a.name.localeCompare(b.name, "de");
                  });
                const cols = 4;
                const rows = Math.max(1, Math.ceil(filteredOthers.length / cols));
                return (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: `repeat(${cols}, minmax(150px, 1fr))`,
                      gridTemplateRows: `repeat(${rows}, auto)`,
                      gridAutoFlow: "column",
                      gap: "6px 16px",
                    }}
                  >
                    {filteredOthers.length === 0 && (
                      <span className="muted" style={{ fontSize: "var(--text-xs)" }}>Keine anderen Spieler</span>
                    )}
                    {filteredOthers.map(q => {
                      const m = mates.find(x => x.player_id === q.id);
                      return (
                        <div key={q.id} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
                          <label className="label--inline" style={{ gap: "var(--space-2)", minWidth: 0, flexShrink: 1 }}>
                            <input type="checkbox" checked={!!m} onChange={() => toggleMate(q.id)} />
                            <span style={{ fontSize: "var(--text-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {q.name}
                            </span>
                          </label>
                          {m && (
                            <label className="label--inline" style={{ gap: 4, fontSize: "var(--text-xs)", color: "var(--color-text-muted)", flexShrink: 0 }}>
                              <input type="checkbox" checked={!!m.mandatory}
                                onChange={(e) => setMandatory(q.id, e.target.checked)} />
                              Pflicht
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <div className="card">
              <h3 className="card__title">Profil</h3>
              <div className="stack">
                <label>
                  Name
                  <input type="text" value={draft.name} onChange={(e) => setField("name", e.target.value)} />
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
                  <label>
                    Min Std/Woche
                    <NumberField min={0} step={0.5} nullable={false}
                      value={slotsToH(draft.min_slots_per_week)}
                      onChange={(v) => setField("min_slots_per_week", hToSlots(v ?? 0))}
                    />
                  </label>
                  <label>
                    Max Std/Woche
                    <NumberField min={0} step={0.5} nullable={false}
                      value={slotsToH(draft.max_slots_per_week)}
                      onChange={(v) => setField("max_slots_per_week", hToSlots(v ?? 0))}
                    />
                  </label>
                </div>
                {draft.min_slots_per_week > draft.max_slots_per_week && (
                  <p style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)", margin: 0 }}>
                    Min Std/Woche darf nicht größer als Max Std/Woche sein.
                  </p>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
                  <label>
                    Geburtsdatum
                    <input type="date"
                      value={pref.birth_date ?? ""}
                      onChange={(e) => setPref("birth_date", e.target.value || null)}
                    />
                    {pref.birth_date && (
                      <span className="muted" style={{ fontSize: "var(--text-xs)", display: "block", marginTop: 2 }}>
                        {computeAge(pref.birth_date)} Jahre alt
                      </span>
                    )}
                  </label>
                  <label>
                    LK (1–25)
                    <input type="number" min={1} max={25}
                      value={pref.level_lk ?? ""} placeholder="(leer)"
                      onChange={(e) => setPref("level_lk", e.target.value === "" ? null : Number(e.target.value))}
                    />
                  </label>
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>
                    Kategorie
                  </label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
                    {(Object.keys(CATEGORY_LABEL) as Category[]).map((cat) => {
                      const on = isCategoryActive(cats, cat);
                      return (
                        <button key={cat} type="button"
                          className={on ? "btn" : "btn--secondary btn"}
                          style={{ fontSize: "var(--text-xs)", padding: "4px 10px" }}
                          onClick={() => setPref("categories", toggleCategory(cats, cat))}
                        >
                          {CATEGORY_LABEL[cat]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label>
                  Notizen
                  <textarea rows={2} value={pref.notes ?? ""}
                    onChange={(e) => setPref("notes", e.target.value)}
                    style={{ resize: "vertical" }}
                  />
                </label>
              </div>
            </div>

            {/* Trainingsform */}
            <div className="card">
              <h3 className="card__title">Trainingsform</h3>
              <p className="muted" style={{ fontSize: "var(--text-xs)", margin: "0 0 var(--space-3)" }}>
                Wunsch-Gruppengröße für den Solver — Einzel=1, Zweier=2, Gruppentraining=3-4.
                Alle drei angehakt = keine Präferenz. Die tatsächliche Wochenstundenzahl kommt
                aus Min/Max Std/Woche oben.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
                {(["single", "double", "group"] as SessionTypePref[]).map((t) => {
                  const on = (pref.allowed_session_types ?? ["single", "double", "group"]).includes(t);
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
              {save.error && (
                <p style={{ margin: "var(--space-2) 0 0", fontSize: "var(--text-xs)", color: "var(--color-danger)" }}>
                  {(save.error as Error).message}
                </p>
              )}
            </div>

            {/* Account section */}
            <div className="card">
              {draft.has_account ? (
                <>
                  <h3 className="card__title">Benutzerkonto</h3>
                  <p className="muted" style={{ margin: 0, fontSize: "var(--text-sm)" }}>
                    ✓ Dieser Spieler hat ein Benutzerkonto und kann sich selbst anmelden.
                  </p>
                  <p className="muted" style={{ fontSize: "var(--text-xs)" }}>
                    Ein Konto darf mit mehreren Spielern verknüpft sein (z.B. Eltern-Account
                    für mehrere Kinder). Soll dieser Spieler stattdessen einen eigenen,
                    separaten Account bekommen, kannst du ihn hier umschreiben.
                  </p>
                  {!showLink ? (
                    <button className="btn--secondary" onClick={() => setShowLink(true)}>
                      Auf anderen Account umschreiben
                    </button>
                  ) : (
                    <div className="stack">
                      <label>
                        E-Mail des neuen Kontos
                        <input type="email" value={linkEmail} onChange={(e) => setLinkEmail(e.target.value)} autoComplete="off" />
                      </label>
                      <div className="row">
                        <button
                          onClick={() => linkAccount.mutate()}
                          disabled={!linkEmail || linkAccount.isPending}
                        >
                          {linkAccount.isPending ? "..." : "Umschreiben"}
                        </button>
                        <button className="btn--ghost" onClick={() => setShowLink(false)}>Abbrechen</button>
                      </div>
                      {linkAccount.error && (
                        <p style={{ color: "var(--color-danger)", margin: 0, fontSize: "var(--text-sm)" }}>
                          {(linkAccount.error as Error).message}
                        </p>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <h3 className="card__title">Benutzerkonto</h3>
                  <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
                    Noch kein Konto verknüpft.
                  </p>
                  {!showAcct && !showLink && (
                    <div className="row">
                      <button className="btn--secondary" onClick={() => setShowAcct(true)}>
                        Neues Konto anlegen
                      </button>
                      <button className="btn--secondary" onClick={() => setShowLink(true)}>
                        Bestehendes Konto verknüpfen
                      </button>
                    </div>
                  )}
                  {showAcct && (
                    <div className="stack">
                      <label>
                        E-Mail
                        <input type="email" value={acctEmail} onChange={(e) => setAcctEmail(e.target.value)} autoComplete="off" />
                      </label>
                      <label>
                        Passwort (mind. 12 Zeichen)
                        <PasswordField value={acctPw} onChange={setAcctPw} autoComplete="new-password" />
                      </label>
                      <div className="row">
                        <button
                          onClick={() => createAccount.mutate()}
                          disabled={!acctEmail || acctPw.length < 12 || createAccount.isPending}
                        >
                          {createAccount.isPending ? "..." : "Konto anlegen"}
                        </button>
                        <button className="btn--ghost" onClick={() => setShowAcct(false)}>Abbrechen</button>
                      </div>
                      {createAccount.error && (
                        <p style={{ color: "var(--color-danger)", margin: 0, fontSize: "var(--text-sm)" }}>
                          {(createAccount.error as Error).message}
                        </p>
                      )}
                    </div>
                  )}
                  {showLink && (
                    <div className="stack">
                      <p className="muted" style={{ fontSize: "var(--text-xs)", margin: 0 }}>
                        E-Mail eines bereits bestehenden Kontos (z.B. schon angelegt über die
                        Benutzer-Verwaltung, aber noch keinem Spieler zugeordnet). Ein Konto darf
                        gleichzeitig mit einem Spieler- und einem Trainer-Datensatz verknüpft sein.
                      </p>
                      <label>
                        E-Mail des bestehenden Kontos
                        <input type="email" value={linkEmail} onChange={(e) => setLinkEmail(e.target.value)} autoComplete="off" />
                      </label>
                      <div className="row">
                        <button
                          onClick={() => linkAccount.mutate()}
                          disabled={!linkEmail || linkAccount.isPending}
                        >
                          {linkAccount.isPending ? "..." : "Verknüpfen"}
                        </button>
                        <button className="btn--ghost" onClick={() => setShowLink(false)}>Abbrechen</button>
                      </div>
                      {linkAccount.error && (
                        <p style={{ color: "var(--color-danger)", margin: 0, fontSize: "var(--text-sm)" }}>
                          {(linkAccount.error as Error).message}
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Prominent, page-wide save bar — deliberately outside/below every
          card, so it reads as "applies to the whole player profile"
          (Verfügbarkeit, Spielpartner, Profil, Trainingseinheiten), not just
          whichever card it visually sits next to. Sticky so it's reachable
          without scrolling back up on a long profile. */}
      {draft && (
        <div
          style={{
            position: "sticky",
            bottom: 0,
            marginTop: "var(--space-5)",
            padding: "var(--space-4) var(--space-5)",
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-lg)",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            flexWrap: "nowrap",
            overflowX: "auto",
          }}
        >
          <div style={{ marginRight: "auto", fontWeight: 700, whiteSpace: "nowrap" }}>{draft.name}</div>
          {dirty && !save.isPending && <span className="pill" style={{ color: "var(--color-warning)", whiteSpace: "nowrap" }}>● Ungespeicherte Änderungen</span>}
          {save.isSuccess && !dirty && <span className="pill pill--success">Gespeichert</span>}
          {save.error && <span style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)" }}>{(save.error as Error).message}</span>}
          {deletePlayer.error && <span style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)" }}>{(deletePlayer.error as Error).message}</span>}
          <button
            className="btn--danger"
            disabled={deletePlayer.isPending}
            onClick={() => {
              if (window.confirm(`Spieler „${draft.name}" wirklich löschen?`)) {
                deletePlayer.mutate();
              }
            }}
          >
            {deletePlayer.isPending ? "..." : "Spieler löschen"}
          </button>
          <button
            style={{ padding: "10px 24px", fontWeight: 700 }}
            onClick={() => save.mutate()}
            disabled={save.isPending || draft.min_slots_per_week > draft.max_slots_per_week}
          >
            {save.isPending ? "speichere..." : "Gesamtes Profil speichern"}
          </button>
        </div>
      )}
    </section>
  );
}
