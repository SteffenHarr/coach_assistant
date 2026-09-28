import { useState, useEffect } from "react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, isLoggedIn } from "../../api/client";
import { LoginRequired, isAuthError } from "../../components/LoginRequired";
import { formatDateDE } from "../../lib/formatDate";

type Season = { id: string; name: string; valid_from: string; valid_to: string };
type Plan = { id: string; season_id: string; score: number; sessions: any[]; published: boolean; created_at: string | null };

function canPublish() {
  const role = sessionStorage.getItem("user_role");
  return role === "admin" || role === "planner";
}

// Only admins/planners generate & manage seasons — coaches only ever view
// already-published plans.
function canManageSeasons() {
  return canPublish();
}

export function PlansPage() {
  const authed = isLoggedIn();
  const qc = useQueryClient();
  const seasons = useQuery({
    queryKey: ["seasons"],
    queryFn: () => api<Season[]>("/seasons"),
    enabled: authed,
  });

  const deleteSeason = useMutation({
    mutationFn: (seasonId: string) => api(`/seasons/${seasonId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["seasons"] }),
  });

  if (!authed) return <LoginRequired />;

  return (
    <section>
      <h2>Trainingspläne</h2>
      {seasons.isLoading && <p>lade...</p>}
      {seasons.error && (isAuthError(seasons.error) ? <LoginRequired /> : (
        <p style={{ color: "var(--color-danger)" }}>{(seasons.error as Error).message}</p>
      ))}

      {seasons.data && seasons.data.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "var(--space-7) var(--space-5)" }}>
          <p style={{ fontSize: "var(--text-md)", marginBottom: "var(--space-4)" }}>
            Noch keine Saison angelegt.
          </p>
          {canManageSeasons() ? (
            <Link to="/plaene/saisonwechsel" className="btn">Erste Saison starten</Link>
          ) : (
            <p className="muted" style={{ margin: 0, fontSize: "var(--text-sm)" }}>
              Ein Admin oder Planer muss zuerst eine Saison anlegen.
            </p>
          )}
        </div>
      )}

      <div className="stack">
        {seasons.data?.map((s) => (
          <div key={s.id} className="card">
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "var(--space-3)", gap: "var(--space-3)" }}>
              <h3 style={{ margin: 0 }}>{s.name}</h3>
              <span style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                <span className="pill">{formatDateDE(s.valid_from)} – {formatDateDE(s.valid_to)}</span>
                {canManageSeasons() && (
                  <button
                    className="btn--danger"
                    style={{ fontSize: "var(--text-xs)", padding: "4px 10px" }}
                    disabled={deleteSeason.isPending}
                    onClick={() => {
                      if (window.confirm(`Saison „${s.name}" inkl. ALLER ihrer Pläne wirklich unwiderruflich löschen?`)) {
                        deleteSeason.mutate(s.id);
                      }
                    }}
                  >
                    Saison löschen
                  </button>
                )}
              </span>
            </div>
            {deleteSeason.error && deleteSeason.variables === s.id && (
              <p style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)" }}>
                {(deleteSeason.error as Error).message}
              </p>
            )}
            <SeasonPlans seasonId={s.id} />
          </div>
        ))}
      </div>
    </section>
  );
}

function formatDateTimeDE(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function SeasonPlans({ seasonId }: { seasonId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["plans", seasonId],
    queryFn: () => api<Plan[]>(`/seasons/${seasonId}/plans`),
  });

  const publish = useMutation({
    mutationFn: (planId: string) => api(`/plans/${planId}/publish`, { method: "PUT" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plans", seasonId] }),
  });

  const unpublish = useMutation({
    mutationFn: (planId: string) => api(`/plans/${planId}/unpublish`, { method: "PUT" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plans", seasonId] }),
  });

  const deletePlan = useMutation({
    mutationFn: (planId: string) => api(`/plans/${planId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plans", seasonId] }),
  });

  // Generate lives here — a direct, one-click action per season. No wizard,
  // no re-asking about constraints: current availabilities/constraints are
  // always used as they stand right now, and this can be clicked again
  // anytime to recompute with whatever has changed since.
  //
  // Runs as a background job (see coach_api.jobs.plan_generation) instead
  // of one long blocking request — a solver run with several variants can
  // take a minute or more, which is exactly the kind of thing that dies to
  // any HTTP/proxy timeout along the way. Here we just kick it off and
  // poll for progress, so there's no timeout risk at all.
  const [numVariants, setNumVariants] = useState(3);
  const [courtFilter, setCourtFilter] = useState<"both" | "indoor" | "outdoor">("both");
  const [showGenerate, setShowGenerate] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);

  const startGenerate = useMutation({
    mutationFn: () =>
      api<{ job_id: string }>("/plans/generate-async", {
        method: "POST",
        body: JSON.stringify({
          season_id: seasonId,
          num_solutions: numVariants,
          time_limit_seconds: 300,
          court_filter: courtFilter,
        }),
      }),
    onSuccess: (res) => setJobId(res.job_id),
  });

  type JobStatus = { status: string; status_text?: string | null; error?: string; plans?: unknown[] };
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
      qc.invalidateQueries({ queryKey: ["plans", seasonId] });
      setJobId(null);
      setShowGenerate(false);
    }
  }, [jobId, jobStatus.data?.status, qc, seasonId]);

  const generating = !!jobId && jobStatus.data?.status !== "finished" && jobStatus.data?.status !== "failed";

  // Group plans into generation batches (same created_at = one "Pläne
  // generieren" click, several score-ranked variants) instead of showing
  // meaningless raw IDs.
  const batches = new Map<string, Plan[]>();
  for (const p of q.data ?? []) {
    const key = p.created_at ?? p.id;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key)!.push(p);
  }
  const batchList = [...batches.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {(!q.data || q.data.length === 0) && (
        <p className="muted" style={{ fontSize: "var(--text-sm)", margin: 0 }}>Noch keine Pläne berechnet.</p>
      )}

      {batchList.map(([createdAt, plans]) => (
        <div key={createdAt}>
          {plans[0]?.created_at && (
            <div className="muted" style={{ fontSize: "var(--text-xs)", marginBottom: "var(--space-2)" }}>
              Generiert am {formatDateTimeDE(plans[0].created_at)}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {plans
              .sort((a, b) => b.score - a.score)
              .map((p, i) => (
                <div
                  key={p.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "var(--space-3) var(--space-4)",
                    background: "var(--color-surface-muted)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-md)",
                  }}
                >
                  <Link
                    to={`/plans/${p.id}`}
                    style={{ fontWeight: 500, color: "var(--color-text)", textDecoration: "none", flex: 1 }}
                  >
                    Variante {i + 1}
                  </Link>
                  <span style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
                    {p.published ? (
                      <span className="pill pill--success">Freigegeben</span>
                    ) : (
                      <span className="pill">Entwurf</span>
                    )}
                    <span className="pill pill--accent">Score {p.score.toFixed(1)}</span>
                    <span className="muted" style={{ fontSize: "var(--text-xs)" }}>{p.sessions.length} Sessions</span>
                    {canPublish() && !p.published && (
                      <button
                        className="btn--secondary"
                        style={{ fontSize: "var(--text-xs)", padding: "4px 10px" }}
                        disabled={publish.isPending}
                        onClick={() => publish.mutate(p.id)}
                      >
                        Freigeben
                      </button>
                    )}
                    {canPublish() && p.published && (
                      <button
                        className="btn--secondary"
                        style={{ fontSize: "var(--text-xs)", padding: "4px 10px" }}
                        disabled={unpublish.isPending}
                        onClick={() => {
                          if (window.confirm("Freigabe wirklich aufheben? Trainer sehen den Plan dann nicht mehr.")) {
                            unpublish.mutate(p.id);
                          }
                        }}
                      >
                        Freigabe aufheben
                      </button>
                    )}
                    {canPublish() && (
                      <button
                        className="btn--danger"
                        style={{ fontSize: "var(--text-xs)", padding: "4px 10px" }}
                        disabled={deletePlan.isPending}
                        onClick={() => {
                          if (window.confirm("Diese Plan-Variante wirklich löschen?")) {
                            deletePlan.mutate(p.id);
                          }
                        }}
                      >
                        Löschen
                      </button>
                    )}
                  </span>
                </div>
              ))}
          </div>
        </div>
      ))}

      {canManageSeasons() && (
        <div>
          {!showGenerate ? (
            <button className="btn--secondary" onClick={() => setShowGenerate(true)}>
              + Neue Pläne berechnen
            </button>
          ) : (
            <div>
              <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: "var(--space-3)" }}>
                <label>
                  Anzahl Varianten
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={numVariants}
                    onChange={(e) => setNumVariants(Number(e.target.value) || 1)}
                    disabled={generating}
                    style={{ width: 80 }}
                  />
                </label>
                <label>
                  Plätze
                  <select
                    value={courtFilter}
                    onChange={(e) => setCourtFilter(e.target.value as "both" | "indoor" | "outdoor")}
                    disabled={generating}
                  >
                    <option value="both">alle (Indoor + Outdoor)</option>
                    <option value="indoor">nur Halle (Indoor)</option>
                    <option value="outdoor">nur draußen (Outdoor)</option>
                  </select>
                </label>
                <button onClick={() => startGenerate.mutate()} disabled={generating || startGenerate.isPending}>
                  {generating ? "rechne…" : "Berechnen"}
                </button>
                <button className="btn--ghost" onClick={() => setShowGenerate(false)} disabled={generating}>
                  Abbrechen
                </button>
              </div>

              {generating && (
                <div style={{ marginTop: "var(--space-3)" }}>
                  <div
                    style={{
                      height: 6,
                      borderRadius: "var(--radius-pill)",
                      background: "var(--color-surface-muted)",
                      overflow: "hidden",
                    }}
                  >
                    <div className="progress-indeterminate" />
                  </div>
                  <p className="muted" style={{ fontSize: "var(--text-xs)", margin: "6px 0 0" }}>
                    {jobStatus.data?.status_text ?? "Berechnung läuft…"}
                  </p>
                </div>
              )}

              {(startGenerate.error || jobStatus.data?.status === "failed") && (
                <p style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)", marginTop: "var(--space-2)" }}>
                  {startGenerate.error
                    ? (startGenerate.error as Error).message
                    : jobStatus.data?.error ?? "Berechnung fehlgeschlagen."}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
