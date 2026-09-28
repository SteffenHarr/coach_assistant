import React from "react";
import ReactDOM from "react-dom/client";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, NavLink, Link, useNavigate, Navigate, useLocation } from "react-router-dom";
import { App } from "./App";
import { ChatPanel } from "./features/chat/ChatPanel";
import { ChatDock } from "./features/chat/ChatDock";
import { PlansPage } from "./features/plan/PlansPage";
import { PlanDetailPage } from "./features/plan/PlanDetailPage";
import { PlanDiffView } from "./features/plan/PlanDiffView";
import { AvailabilityPage } from "./features/availability/AvailabilityPage";
import { CoachEditorPage } from "./features/coach/CoachEditorPage";
import { CoachListPage } from "./features/coach/CoachListPage";
import { CourtsAdminPage } from "./features/court/CourtsAdminPage";
import { CoachProfilePage } from "./features/coach/CoachProfilePage";
import { PlayerListPage } from "./features/player/PlayerListPage";
import { PlayerProfilePage } from "./features/player/PlayerProfilePage";
import { PlayerEditorPage } from "./features/player/PlayerEditorPage";
import { ReplanWizard } from "./features/replan/ReplanWizard";
import { UsersAdminPage } from "./features/admin/UsersAdminPage";
import { AccountSettingsPage } from "./features/account/AccountSettingsPage";
import { ImpressumPage } from "./features/legal/ImpressumPage";
import { DatenschutzPage } from "./features/legal/DatenschutzPage";
import { LegalFooterLinks } from "./features/legal/LegalFooterLinks";
import { PrivacyConsentGate } from "./features/legal/PrivacyConsentGate";
import { PlansLayout, CoachLayout, PlayerLayout } from "./features/nav/Layouts";
import { HomePage } from "./features/home/HomePage";
import { NavMenuButton, NavMenuPanel } from "./features/nav/NavMenu";
import { isLoggedIn, logout, api } from "./api/client";
import { confirmNavigation } from "./lib/unsavedChanges";
import "./index.css";

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const status = (error as { status?: number })?.status;
        if (status === 401 || status === 403) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
    },
  },
});

// Der QueryClient-Cache ist global im Tab, nicht pro Konto getrennt —
// Queries wie ["me"] werden von mehreren Seiten geteilt (siehe
// PrivacyConsentGate, UsersAdminPage, CoachListPage, ...). Meldet sich
// jemand im selben Tab ab und mit einem anderen Konto wieder an, würden
// diese Seiten sonst kurzzeitig noch die gecachten Daten des vorigen
// Kontos zeigen (z.B. "Datenschutz schon akzeptiert", weil das noch vom
// vorherigen Admin-Login im Cache stand), bis ein Hintergrund-Refetch das
// irgendwann korrigiert. Deshalb: kompletten Cache leeren, sobald sich der
// Access-Token tatsächlich ändert (Login/Logout/Kontowechsel) — aber nicht
// bei jedem der periodischen "storage"-Events, die App-weit nur zum
// Auffrischen der Rolle dienen und den Token gar nicht ändern.
let lastAccessToken = sessionStorage.getItem("access_token");
window.addEventListener("storage", () => {
  const current = sessionStorage.getItem("access_token");
  if (current !== lastAccessToken) {
    lastAccessToken = current;
    qc.clear();
  }
});

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  "app-nav__link" + (isActive ? " app-nav__link--active" : "");

function AuthNavLink() {
  const [authed, setAuthed] = useState<boolean>(isLoggedIn);
  const nav = useNavigate();

  useEffect(() => {
    const refresh = () => {
      const ok = isLoggedIn();
      setAuthed(ok);
      if (ok) {
        // Der Token zum Zeitpunkt der Anfrage — falls sich zwischenzeitlich
        // jemand ab- und mit einem anderen Konto wieder angemeldet hat, bis
        // diese Antwort zurückkommt, gehört die Antwort zum alten Konto und
        // darf die (schon aktuelle) Rolle nicht mehr überschreiben.
        const tokenAtRequest = sessionStorage.getItem("access_token");
        api<{ role: string; privacy_accepted_at: string | null }>("/me")
          .then((u) => {
            if (sessionStorage.getItem("access_token") !== tokenAtRequest) return;
            // Datenschutz-Flag bei jedem Refresh aktuell halten (z.B. falls
            // auf einem anderen Gerät/Tab akzeptiert wurde) — im
            // Unterschied zur Rolle unten kostet das kein zusätzliches
            // Dispatch/keinen Loop, weil PrivacyConsentGate selbst nicht
            // erneut auf "storage" reagiert, um wiederum diesen Refresh
            // auszulösen.
            sessionStorage.setItem("privacy_accepted", u.privacy_accepted_at ? "1" : "0");
            // Nur dispatchen, wenn sich die Rolle wirklich geändert hat.
            // refresh() lauscht selbst auf "storage" (siehe unten) — ein
            // bedingungsloses Dispatch hier hätte sich sonst bei jedem
            // erfolgreichen Fetch selbst erneut ausgelöst: Endlos-Loop, der
            // /me ohne Pause abfragt, bis der Browser am
            // Verbindungslimit hängt.
            if (sessionStorage.getItem("user_role") !== u.role) {
              sessionStorage.setItem("user_role", u.role);
              window.dispatchEvent(new Event("storage"));
            }
          })
          .catch((err) => {
            const status = (err as { status?: number })?.status;
            if (status === 401 || status === 403) {
              setAuthed(false);
              sessionStorage.removeItem("user_role");
              sessionStorage.removeItem("privacy_accepted");
            }
          });
      } else {
        sessionStorage.removeItem("user_role");
      }
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    const id = window.setInterval(refresh, 15000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
      window.clearInterval(id);
    };
  }, []);

  if (authed) {
    return (
      <button
        className="app-nav__link"
        onClick={() => { if (!confirmNavigation()) return; logout(); nav("/"); }}
      >
        Abmelden
      </button>
    );
  }
  return (
    <NavLink to="/" className={navLinkClass}>
      Anmelden
    </NavLink>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState<boolean>(isLoggedIn);
  useEffect(() => {
    const sync = () => setAuthed(isLoggedIn());
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);
  if (!authed) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function PlayerIndexRoute() {
  // Plain players only ever see themselves in the roster — send them
  // straight to their own profile instead of a redundant one-row list.
  const role = sessionStorage.getItem("user_role");
  const isStaff = role === "admin" || role === "planner" || role === "coach";
  return isStaff ? <PlayerListPage /> : <Navigate to="/spieler/profil" replace />;
}

function AuthedOnly({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState<boolean>(isLoggedIn);
  useEffect(() => {
    const sync = () => setAuthed(isLoggedIn());
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);
  if (!authed) return null;
  return <>{children}</>;
}

function AppFooter() {
  return (
    <footer style={{ padding: "var(--space-4) var(--space-5)", display: "flex", justifyContent: "center" }}>
      <LegalFooterLinks />
    </footer>
  );
}

function AppShell() {
  const location = useLocation();
  const isHome = location.pathname === "/";
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the panel automatically when navigating away (e.g. via a tile).
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <PrivacyConsentGate />
      <div className={`app-content${menuOpen ? " app-content--blurred" : ""}`}>
        {!isHome && (
          <nav className="app-nav">
            <Link
              to="/"
              className="app-nav__brand"
              onClick={(e) => { if (!confirmNavigation()) e.preventDefault(); }}
            >
              <span className="app-nav__brand-dot" aria-hidden />
              Coach Assistant
            </Link>
            <AuthedOnly>
              <NavMenuButton open={menuOpen} setOpen={setMenuOpen} />
            </AuthedOnly>
            <span className="app-nav__spacer" />
            <AuthedOnly>
              <NavLink
                to="/konto"
                className={navLinkClass}
                title="Mein Konto"
                onClick={(e) => { if (!confirmNavigation()) e.preventDefault(); }}
              >
                Mein Konto
              </NavLink>
            </AuthedOnly>
            <AuthNavLink />
          </nav>
        )}
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/plaene" element={<RequireAuth><App><PlansLayout /></App></RequireAuth>}>
          <Route index element={<PlansPage />} />
          <Route path="vergleich" element={<PlanDiffView />} />
          <Route path="saisonwechsel" element={<ReplanWizard />} />
        </Route>
        <Route path="/plans/:planId" element={<RequireAuth><App><PlanDetailPage /></App></RequireAuth>} />
        <Route path="/verfuegbarkeiten" element={<RequireAuth><App><AvailabilityPage /></App></RequireAuth>} />
        <Route path="/plaetze" element={<RequireAuth><App><CourtsAdminPage /></App></RequireAuth>} />
        <Route path="/trainer" element={<RequireAuth><App><CoachLayout /></App></RequireAuth>}>
          <Route index element={<CoachListPage />} />
          <Route path="profil" element={<CoachProfilePage />} />
          <Route path="bulk" element={<CoachEditorPage />} />
        </Route>
        <Route path="/spieler" element={<RequireAuth><App><PlayerLayout /></App></RequireAuth>}>
          <Route index element={<PlayerIndexRoute />} />
          <Route path="profil" element={<PlayerProfilePage />} />
          <Route path="daten" element={<PlayerEditorPage />} />
        </Route>
        <Route path="/chat" element={<RequireAuth><App><ChatPanel /></App></RequireAuth>} />
        <Route path="/admin/users" element={<RequireAuth><App><UsersAdminPage /></App></RequireAuth>} />
        <Route path="/konto" element={<RequireAuth><App><AccountSettingsPage /></App></RequireAuth>} />
        <Route path="/impressum" element={<App><ImpressumPage /></App>} />
        <Route path="/datenschutz" element={<App><DatenschutzPage /></App>} />
      </Routes>
        {!isHome && <AppFooter />}
        {!isHome && <ChatDock />}
      </div>
      <NavMenuPanel open={menuOpen} setOpen={setMenuOpen} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
