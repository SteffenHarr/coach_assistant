import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, isLoggedIn } from "../../api/client";

type Me = { privacy_accepted_at: string | null };

// "unknown" so lange login()/AuthNavLink noch keine definitive Antwort von
// /me hatten — in dem Zustand wird NICHTS angezeigt (siehe unten), auch
// nicht die Sperre. Erst eine eindeutige "0" zeigt sie an; ein "vorsichtshalber
// schon mal anzeigen, falls wir's noch nicht wissen" hat vorher dazu geführt,
// dass die Sperre bei jedem Login kurz aufblitzte und sofort wieder
// verschwand, sobald die eigentliche Antwort ankam — das sah kaputt aus.
// Lieber ein paar hundert Millisekunden gar nichts zeigen als etwas falsch
// Blinkendes.
type ConsentStatus = "unknown" | "accepted" | "not-accepted";

function consentStatus(): ConsentStatus {
  const flag = sessionStorage.getItem("privacy_accepted");
  if (flag === "1") return "accepted";
  if (flag === "0") return "not-accepted";
  return "unknown";
}

/**
 * Blocking, non-dismissable overlay shown once per account on first login
 * until the Datenschutzerklärung is actively confirmed (see Punkt 5 dort —
 * Minderjährige/Zustimmung beim ersten Login). Mounted once in AppShell so
 * it appears regardless of which page the user lands on after logging in.
 *
 * Liest den Status synchron aus sessionStorage statt selbst per useQuery
 * nachzufragen — login() (api/client.ts) prüft "/me" bereits direkt als
 * Teil des Login-Vorgangs und legt das Ergebnis dort ab, bevor das
 * "storage"-Event gefeuert wird. Ein eigener Fetch hier hätte im schlimmsten
 * Fall (überlastete Verbindung, Netzwerk-Hänger) minutenlang hängen können,
 * während die Sperre in der Zwischenzeit gar nicht griff.
 */
export function PrivacyConsentGate() {
  const [authed, setAuthed] = useState<boolean>(isLoggedIn);
  const [status, setStatus] = useState<ConsentStatus>(consentStatus);
  useEffect(() => {
    const sync = () => {
      setAuthed(isLoggedIn());
      setStatus(consentStatus());
    };
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);
  const [checked, setChecked] = useState(false);

  const accept = useMutation({
    mutationFn: () => api<Me>("/me/accept-privacy", { method: "POST" }),
    onSuccess: () => {
      sessionStorage.setItem("privacy_accepted", "1");
      setStatus("accepted");
    },
  });

  if (!authed || status !== "not-accepted") return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(11, 17, 32, 0.72)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-5)",
      }}
    >
      <div
        className="card"
        role="dialog"
        aria-modal
        aria-label="Datenschutzerklärung bestätigen"
        style={{ maxWidth: 480, width: "100%" }}
      >
        <h3 className="card__title">Bevor es losgeht: Datenschutz</h3>
        <p style={{ fontSize: "var(--text-sm)" }}>
          Wir verarbeiten hier personenbezogene Daten (u. a. Geburtsdatum, Verfügbarkeiten,
          Spielstärke) zur Organisation des Trainingsbetriebs. Bitte lesen Sie kurz nach, welche
          Daten das sind und wofür sie genutzt werden.
        </p>
        <p>
          <Link to="/datenschutz" target="_blank" rel="noreferrer">
            → Datenschutzerklärung in neuem Tab öffnen
          </Link>
        </p>
        <label className="label--inline" style={{ gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span style={{ fontSize: "var(--text-sm)" }}>
            Ich habe die Datenschutzerklärung gelesen und bin einverstanden (bei Kindern/Jugendlichen:
            als Erziehungsberechtigte/r).
          </span>
        </label>
        <div className="row" style={{ marginTop: "var(--space-4)" }}>
          <button onClick={() => accept.mutate()} disabled={!checked || accept.isPending}>
            {accept.isPending ? "…" : "Bestätigen und fortfahren"}
          </button>
          {accept.error && (
            <span style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)" }}>
              {(accept.error as Error).message}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
