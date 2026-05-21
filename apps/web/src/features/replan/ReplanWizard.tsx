import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, isLoggedIn } from "../../api/client";
import { LoginRequired } from "../../components/LoginRequired";

type Season = { id: string; name: string; valid_from: string; valid_to: string };
type Plan = { id: string; season_id: string; score: number; sessions: any[] };

type Step = 0 | 1 | 2 | 3;

export function ReplanWizard() {
  const qc = useQueryClient();
  const authed = isLoggedIn();
  const [step, setStep] = useState<Step>(0);

  // Step 0: pick previous season (for diff baseline)
  const seasons = useQuery({ queryKey: ["seasons"], queryFn: () => api<Season[]>("/seasons"), enabled: authed });
  const [previousSeasonId, setPreviousSeasonId] = useState<string>("");

  // Step 1: create new season
  const [name, setName] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [newSeasonId, setNewSeasonId] = useState<string | null>(null);

  const createSeason = useMutation({
    mutationFn: () =>
      api<Season>("/seasons", {
        method: "POST",
        body: JSON.stringify({ name, valid_from: validFrom, valid_to: validTo }),
      }),
    onSuccess: (s) => {
      setNewSeasonId(s.id);
      qc.invalidateQueries({ queryKey: ["seasons"] });
      setStep(2);
    },
  });

  // Step 3: generate plan
  const [numVariants, setNumVariants] = useState(3);
  const [generated, setGenerated] = useState<Plan[] | null>(null);
  const generate = useMutation({
    mutationFn: () =>
      api<Plan[]>("/plans/generate", {
        method: "POST",
        body: JSON.stringify({
          season_id: newSeasonId,
          num_solutions: numVariants,
          time_limit_seconds: 30,
        }),
      }),
    onSuccess: (plans) => setGenerated(plans),
  });

  // Baseline plan from previous season
  const baseline = useQuery({
    queryKey: ["best-plan", previousSeasonId],
    queryFn: () => api<Plan | null>(`/seasons/${previousSeasonId}/best-plan`),
    enabled: !!previousSeasonId && step === 3 && authed,
  });

  if (!authed) return <LoginRequired />;

  return (
    <section>
      <h2>Saisonwechsel-Assistent</h2>
      <Stepper step={step} />

      {step === 0 && (
        <Card title="1. Vorherige Saison wählen (optional, für Vergleich)">
          {seasons.isLoading && <p>lade...</p>}
          <select value={previousSeasonId} onChange={(e) => setPreviousSeasonId(e.target.value)}>
            <option value="">— keine —</option>
            {seasons.data?.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <Nav onNext={() => setStep(1)} />
        </Card>
      )}

      {step === 1 && (
        <Card title="2. Neue Saison anlegen">
          <div style={{ display: "grid", gap: 8, maxWidth: 380 }}>
            <input placeholder="Name (z. B. Sommer 2026)" value={name} onChange={(e) => setName(e.target.value)} />
            <label>Gültig von <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></label>
            <label>Gültig bis <input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} /></label>
            {createSeason.error && <p style={{ color: "crimson" }}>Anlegen fehlgeschlagen.</p>}
          </div>
          <Nav
            onPrev={() => setStep(0)}
            onNext={() => createSeason.mutate()}
            nextLabel={createSeason.isPending ? "lege an..." : "Anlegen & weiter"}
            nextDisabled={!name || !validFrom || !validTo || createSeason.isPending}
          />
        </Card>
      )}

      {step === 2 && (
        <Card title="3. Verfügbarkeiten & Constraints prüfen">
          <p>
            Aktualisiere bei Bedarf die Verfügbarkeiten und Trainer-Vorgaben.
            Diese gelten saisonübergreifend (das, was du jetzt setzt, wird für die neue Saison verwendet).
          </p>
          <div style={{ display: "flex", gap: 12 }}>
            <Link to="/availability">→ Verfügbarkeiten bearbeiten</Link>
            <Link to="/coaches">→ Trainer-Constraints bearbeiten</Link>
          </div>
          <Nav onPrev={() => setStep(1)} onNext={() => setStep(3)} nextLabel="Weiter" />
        </Card>
      )}

      {step === 3 && (
        <Card title="4. Pläne generieren">
          <label>
            Anzahl Varianten:&nbsp;
            <input
              type="number"
              min={1}
              max={10}
              value={numVariants}
              onChange={(e) => setNumVariants(Number(e.target.value) || 1)}
            />
          </label>
          <button
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            style={{ marginLeft: 12, padding: "8px 16px" }}
          >
            {generate.isPending ? "rechne..." : "Pläne generieren"}
          </button>

          {generated && (
            <>
              <h3 style={{ marginTop: 16 }}>Ergebnis</h3>
              <ul>
                {generated.map((p) => (
                  <li key={p.id}>
                    <Link to={`/plans/${p.id}`}>
                      Plan {p.id.slice(0, 8)} – Score {p.score.toFixed(1)} – {p.sessions.length} Sessions
                    </Link>
                    {baseline.data && (
                      <>
                        {" · "}
                        <Link to={`/diff?old=${baseline.data.id}&new=${p.id}`}>
                          Vergleich mit alter Saison
                        </Link>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              {baseline.data === null && previousSeasonId && (
                <p style={{ color: "#666" }}>Keine Pläne in der vorherigen Saison gefunden.</p>
              )}
            </>
          )}

          <Nav onPrev={() => setStep(2)} />
        </Card>
      )}
    </section>
  );
}

function Stepper({ step }: { step: Step }) {
  const labels = ["Vergleichs-Saison", "Neue Saison", "Daten prüfen", "Plan erzeugen"];
  return (
    <ol style={{ display: "flex", gap: 16, padding: 0, listStyle: "none", marginBottom: 16 }}>
      {labels.map((l, i) => (
        <li key={l} style={{
          padding: "4px 10px",
          borderRadius: 4,
          background: i === step ? "#2e7d32" : i < step ? "#a5d6a7" : "#eee",
          color: i === step ? "#fff" : "#333",
          fontSize: 13,
        }}>
          {i + 1}. {l}
        </li>
      ))}
    </ol>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, marginBottom: 12 }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {children}
    </div>
  );
}

function Nav({
  onPrev,
  onNext,
  nextLabel = "Weiter",
  nextDisabled,
}: {
  onPrev?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
}) {
  return (
    <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
      {onPrev && <button onClick={onPrev}>← Zurück</button>}
      {onNext && (
        <button onClick={onNext} disabled={nextDisabled} style={{ marginLeft: "auto" }}>
          {nextLabel}
        </button>
      )}
    </div>
  );
}
