import { useState, useEffect } from "react";
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

  // Step 3: generate plan — runs as a background job (see PlansPage.tsx for
  // the full rationale) instead of one long blocking request, so there's no
  // HTTP timeout risk regardless of how many variants are requested.
  const [numVariants, setNumVariants] = useState(3);
  const [courtFilter, setCourtFilter] = useState<"both" | "indoor" | "outdoor">("both");
  const [generated, setGenerated] = useState<{ id: string; score: number; sessions: number }[] | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const startGenerate = useMutation({
    mutationFn: () =>
      api<{ job_id: string }>("/plans/generate-async", {
        method: "POST",
        body: JSON.stringify({
          season_id: newSeasonId,
          num_solutions: numVariants,
          time_limit_seconds: 300,
          court_filter: courtFilter,
        }),
      }),
    onSuccess: (res) => { setGenerated(null); setJobId(res.job_id); },
  });

  type JobStatus = { status: string; status_text?: string | null; error?: string; plans?: { id: string; score: number; sessions: number }[] };
  const jobStatus = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api<JobStatus>(`/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "finished" || s === "failed" ? false : 1500;
    },
  });

  useEffect(() => {
    if (jobId && jobStatus.data?.status === "finished") {
      setGenerated(jobStatus.data.plans ?? []);
      setJobId(null);
    }
  }, [jobId, jobStatus.data]);

  const generating = !!jobId && jobStatus.data?.status !== "finished" && jobStatus.data?.status !== "failed";

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
          <div style={{ display: "grid", gap: "var(--space-3)", maxWidth: 380 }}>
            <label>
              Name
              <input placeholder="z. B. Sommer 2026" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Gültig von
              <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </label>
            <label>
              Gültig bis
              <input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
            </label>
            {createSeason.error && <p style={{ color: "var(--color-danger)" }}>Anlegen fehlgeschlagen.</p>}
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
          <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
            <label>
              Anzahl Varianten
              <input
                type="number"
                min={1}
                max={10}
                value={numVariants}
                onChange={(e) => setNumVariants(Number(e.target.value) || 1)}
              />
            </label>
            <label>
              Plätze
              <select
                value={courtFilter}
                onChange={(e) =>
                  setCourtFilter(e.target.value as "both" | "indoor" | "outdoor")
                }
              >
                <option value="both">alle (Indoor + Outdoor)</option>
                <option value="indoor">nur Halle (Indoor)</option>
                <option value="outdoor">nur draußen (Outdoor)</option>
              </select>
            </label>
            <button
              onClick={() => startGenerate.mutate()}
              disabled={generating || startGenerate.isPending}
            >
              {generating ? "rechne…" : "Pläne generieren"}
            </button>
          </div>

          {generating && (
            <div style={{ marginTop: "var(--space-3)", maxWidth: 380 }}>
              <div style={{ height: 6, borderRadius: "var(--radius-pill)", background: "var(--color-surface-muted)", overflow: "hidden" }}>
                <div className="progress-indeterminate" />
              </div>
              <p className="muted" style={{ fontSize: "var(--text-xs)", margin: "6px 0 0" }}>
                {jobStatus.data?.status_text ?? "Berechnung läuft…"}
              </p>
            </div>
          )}

          {(startGenerate.error || jobStatus.data?.status === "failed") && (
            <p style={{ color: "var(--color-danger)" }}>
              Fehler: {startGenerate.error ? (startGenerate.error as Error).message : jobStatus.data?.error}
            </p>
          )}

          {generated && (
            <>
              <h3 style={{ marginTop: 16 }}>Ergebnis</h3>
              <ul>
                {[...generated].sort((a, b) => b.score - a.score).map((p, i) => (
                  <li key={p.id}>
                    <Link to={`/plans/${p.id}`}>
                      Variante {i + 1} – Score {p.score.toFixed(1)} – {p.sessions} Sessions
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
          padding: "4px 12px",
          borderRadius: "var(--radius-pill)",
          background: i === step ? "var(--color-primary)" : i < step ? "var(--color-primary-soft)" : "var(--color-surface-muted)",
          color: i === step ? "var(--color-primary-fg)" : i < step ? "var(--color-primary)" : "var(--color-text-muted)",
          fontSize: "var(--text-sm)",
          fontWeight: i === step ? 600 : 400,
          border: i === step ? "none" : "1px solid var(--color-border)",
        }}>
          {i + 1}. {l}
        </li>
      ))}
    </ol>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h3 className="card__title">{title}</h3>
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
