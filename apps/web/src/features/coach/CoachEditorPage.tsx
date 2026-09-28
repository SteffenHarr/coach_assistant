import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, isLoggedIn } from "../../api/client";
import { AvailabilityGrid } from "../availability/AvailabilityGrid";
import { SLOT_MINUTES } from "../../lib/timeGrid";
import { LoginRequired, isAuthError } from "../../components/LoginRequired";
import { type Category, CATEGORY_LABEL, isCategoryActive, toggleCategory } from "../../lib/categories";
import { PasswordField } from "../../lib/PasswordField";

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
  has_account?: boolean;
};

const slotsForHours = (h: number) => Math.round((h * 60) / SLOT_MINUTES);
const hoursForSlots = (s: number | null) => (s == null ? "" : (s * SLOT_MINUTES) / 60);

export function CoachEditorPage() {
  const qc = useQueryClient();
  const authed = isLoggedIn();
  const list = useQuery({ queryKey: ["coaches"], queryFn: () => api<Coach[]>("/coaches"), enabled: authed });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Coach | null>(null);
  const [newName, setNewName] = useState("");
  const [acctEmail, setAcctEmail] = useState("");
  const [acctPw, setAcctPw] = useState("");
  const [showAcct, setShowAcct] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [linkEmail, setLinkEmail] = useState("");

  useEffect(() => {
    if (!selectedId && list.data?.length) setSelectedId(list.data[0].id);
  }, [list.data, selectedId]);

  useEffect(() => {
    const c = list.data?.find((c) => c.id === selectedId) ?? null;
    setDraft(c ? structuredClone(c) : null);
    setShowAcct(false);
    setAcctEmail("");
    setAcctPw("");
    setShowLink(false);
    setLinkEmail("");
  }, [selectedId, list.data]);

  const createCoach = useMutation({
    mutationFn: () => api<Coach>("/coaches/quick", { method: "POST", body: JSON.stringify({ name: newName.trim() }) }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["coaches"] });
      setSelectedId(c.id);
      setNewName("");
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      await api(`/coaches/${draft.id}`, {
        method: "PUT",
        body: JSON.stringify(draft),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coaches"] }),
  });

  const deleteCoach = useMutation({
    mutationFn: () => api(`/coaches/${draft!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.setQueryData<Coach[]>(["coaches"], (old) => old?.filter((c) => c.id !== draft!.id) ?? []);
      qc.invalidateQueries({ queryKey: ["coaches"] });
      setSelectedId(null);
    },
  });

  const createAccount = useMutation({
    mutationFn: () => api(`/coaches/${draft!.id}/account`, {
      method: "POST",
      body: JSON.stringify({ email: acctEmail, password: acctPw }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coaches"] });
      qc.invalidateQueries({ queryKey: ["users"] });
      setShowAcct(false);
    },
  });

  const linkAccount = useMutation({
    mutationFn: () => api(`/coaches/${draft!.id}/link-account`, {
      method: "PATCH",
      body: JSON.stringify({ email: linkEmail }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coaches"] });
      qc.invalidateQueries({ queryKey: ["users"] });
      setShowLink(false);
      setLinkEmail("");
    },
  });

  return (
    <section>
      <h2>Trainer & Constraints</h2>
      {!authed && <LoginRequired />}
      {list.isLoading && <p>lade...</p>}
      {list.error && (isAuthError(list.error) ? <LoginRequired /> : (
        <p style={{ color: "var(--color-danger)" }}>{(list.error as Error).message}</p>
      ))}

      {/* Quick create */}
      <div className="card" style={{ marginBottom: "var(--space-4)" }}>
        <h3 className="card__title">Neuen Trainer anlegen</h3>
        <div className="row">
          <input
            type="text"
            placeholder="Name des Trainers"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && newName.trim() && createCoach.mutate()}
            style={{ flex: 1 }}
          />
          <button onClick={() => createCoach.mutate()} disabled={!newName.trim() || createCoach.isPending}>
            {createCoach.isPending ? "..." : "Anlegen"}
          </button>
        </div>
        {createCoach.error && (
          <p style={{ color: "var(--color-danger)", margin: "var(--space-2) 0 0", fontSize: "var(--text-sm)" }}>
            {(createCoach.error as Error).message}
          </p>
        )}
      </div>

      {/* Trainer selector */}
      {list.data && list.data.length > 0 && (
        <div className="tabs" style={{ marginBottom: "var(--space-4)" }}>
          {list.data.map((c) => (
            <button
              key={c.id}
              className={`tab${selectedId === c.id ? " tab--active" : ""}`}
              onClick={() => setSelectedId(c.id)}
            >
              {c.name}{c.has_account ? "" : " ●"}
            </button>
          ))}
        </div>
      )}

      {draft && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "var(--space-5)" }}>
          <div className="card">
            <h3 className="card__title">Verfügbarkeit</h3>
            <AvailabilityGrid
              value={draft.availability}
              onChange={(slots) => setDraft({ ...draft, availability: slots })}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <div className="card">
              <h3 className="card__title">Einschränkungen</h3>
              <div className="stack">
                <NumField label="Mindest-Block (Std. am Stück)" value={hoursForSlots(draft.constraints.min_block_slots)}
                  onChange={(h) => setDraft({ ...draft, constraints: { ...draft.constraints, min_block_slots: slotsForHours(Number(h) || 0) } })} step={0.5} />
                <NumField label="Max Std/Tag" value={hoursForSlots(draft.constraints.max_slots_per_day)} allowEmpty
                  onChange={(h) => setDraft({ ...draft, constraints: { ...draft.constraints, max_slots_per_day: h === "" ? null : slotsForHours(Number(h)) } })} step={0.5} />
                <NumField label="Max Std/Woche" value={hoursForSlots(draft.constraints.max_slots_per_week)} allowEmpty
                  onChange={(h) => setDraft({ ...draft, constraints: { ...draft.constraints, max_slots_per_week: h === "" ? null : slotsForHours(Number(h)) } })} step={0.5} />
                <NumField label="Mindest-Pause (Std.)" value={hoursForSlots(draft.constraints.min_break_slots)}
                  onChange={(h) => setDraft({ ...draft, constraints: { ...draft.constraints, min_break_slots: slotsForHours(Number(h) || 0) } })} step={0.5} />
                <NumField label="Max Gruppengröße" value={draft.max_group_size}
                  onChange={(v) => setDraft({ ...draft, max_group_size: Math.max(1, Number(v) || 1) })} step={1} />
                {draft.constraints.max_slots_per_day != null &&
                  draft.constraints.min_block_slots > draft.constraints.max_slots_per_day && (
                    <p style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)", margin: 0 }}>
                      Mindest-Block darf nicht größer als Max Std/Tag sein.
                    </p>
                )}

                <div>
                  <label style={{ display: "block", marginBottom: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>
                    Trainings-Kategorien
                  </label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
                    {(Object.keys(CATEGORY_LABEL) as Category[]).map((cat) => {
                      const cur = draft.categories ?? [];
                      const on = isCategoryActive(cur, cat);
                      return (
                        <button key={cat} type="button"
                          className={on ? "btn" : "btn--secondary btn"}
                          style={{ fontSize: "var(--text-xs)", padding: "4px 10px" }}
                          onClick={() => setDraft({ ...draft, categories: toggleCategory(cur, cat) })}
                        >
                          {CATEGORY_LABEL[cat]}
                        </button>
                      );
                    })}
                  </div>
                  <p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "var(--space-1)" }}>
                    Leer oder "frei" = nimmt jeden Spieler
                  </p>
                </div>
              </div>

              <div className="row" style={{ marginTop: "var(--space-4)" }}>
                <button
                  onClick={() => save.mutate()}
                  disabled={
                    save.isPending ||
                    (draft.constraints.max_slots_per_day != null &&
                      draft.constraints.min_block_slots > draft.constraints.max_slots_per_day)
                  }
                >
                  {save.isPending ? "speichere..." : "Speichern"}
                </button>
                <button
                  className="btn--danger"
                  style={{ marginLeft: "auto" }}
                  disabled={deleteCoach.isPending}
                  onClick={() => {
                    if (window.confirm(`Trainer „${draft.name}" wirklich löschen?`)) {
                      deleteCoach.mutate();
                    }
                  }}
                >
                  {deleteCoach.isPending ? "..." : "Löschen"}
                </button>
                {save.isSuccess && <span className="pill pill--success">Gespeichert</span>}
                {save.error && <span style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)" }}>{(save.error as Error).message}</span>}
                {deleteCoach.error && <span style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)" }}>{(deleteCoach.error as Error).message}</span>}
              </div>
            </div>

            {/* Account section */}
            <div className="card">
              {draft.has_account ? (
                <p className="muted" style={{ margin: 0, fontSize: "var(--text-sm)" }}>
                  ✓ Dieser Trainer hat ein Benutzerkonto.
                </p>
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
                        Benutzer-Verwaltung, aber noch keinem Trainer zugeordnet). Ein Konto darf
                        gleichzeitig mit einem Trainer- und einem Spieler-Datensatz verknüpft sein.
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
    </section>
  );
}

function NumField({ label, value, onChange, step, allowEmpty }: {
  label: string; value: number | string; onChange: (v: string) => void; step: number; allowEmpty?: boolean;
}) {
  // Raw text kept locally (like NumberField) so leading-zero artefacts
  // (e.g. "01" after backspacing a "0" down to empty) never render — the
  // parent only hears about the change once the field is committed.
  const [text, setText] = useState<string>(value === "" ? "" : String(value));

  useEffect(() => {
    const incoming = value === "" ? "" : String(value);
    const parsed = parseFloat(text);
    if (text === "" || isNaN(parsed) || parsed !== Number(value)) {
      setText(incoming);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function commit(raw: string) {
    if (raw.trim() === "") {
      setText("");
      onChange(allowEmpty ? "" : "0");
      return;
    }
    const n = parseFloat(raw.replace(",", "."));
    if (isNaN(n)) {
      setText(value === "" ? "" : String(value));
      return;
    }
    const clamped = Math.max(0, n);
    setText(String(clamped));
    onChange(String(clamped));
  }

  return (
    <label>
      <span>{label}</span>
      <input type="number" min={0} step={step}
        value={text}
        placeholder={allowEmpty ? "(unbegrenzt)" : ""}
        onChange={(e) => setText(e.target.value.replace(/^0+(?=\d)/, ""))}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
    </label>
  );
}
