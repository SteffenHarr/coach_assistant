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
import { CoachProfilePage } from "./features/coach/CoachProfilePage";
import { PlayerListPage } from "./features/player/PlayerListPage";
import { PlayerProfilePage } from "./features/player/PlayerProfilePage";
import { ReplanWizard } from "./features/replan/ReplanWizard";
import { LoginPage } from "./features/auth/LoginPage";
import { UsersAdminPage } from "./features/admin/UsersAdminPage";
import { PlansLayout, CoachLayout, PlayerLayout } from "./features/nav/Layouts";
import { isLoggedIn, logout, api } from "./api/client";
import "./index.css";

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't retry auth errors (401/403) — keeps the "please log in"
      // message instant instead of waiting 10+ s for 3 retry attempts.
      retry: (failureCount, error) => {
        const status = (error as { status?: number })?.status;
        if (status === 401 || status === 403) return false;
        return failureCount < 2;
      },
      // Short retry delay; default exponential backoff was up to ~30 s.
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
    },
  },
});

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  "app-nav__link" + (isActive ? " app-nav__link--active" : "");

function AuthNavLink() {
  const [authed, setAuthed] = useState<boolean>(isLoggedIn);
  // Seed from sessionStorage so the role-gated nav links stay visible
  // immediately after a page reload, before /me has answered.
  const [role, setRole] = useState<string | null>(
    () => sessionStorage.getItem("user_role"),
  );
  const nav = useNavigate();

  useEffect(() => {
    const refresh = () => {
      const ok = isLoggedIn();
      setAuthed(ok);
      if (ok) {
        api<{ role: string }>("/me")
          .then((u) => {
            setRole(u.role);
            sessionStorage.setItem("user_role", u.role);
            // storage events fire only in *other* tabs - in this tab
            // wir m\u00fcssen den Listener (z.B. AdminOnlyLink) selbst anstupsen,
            // sonst erscheint der Admin-Reiter erst nach dem n\u00e4chsten Poll.
            window.dispatchEvent(new Event("storage"));
          })
          .catch((err) => {
            // 401/403 → token is invalid. `api()` has already wiped
            // sessionStorage; reflect that locally so the button flips
            // from "Abmelden" to "Anmelden" without waiting for the
            // next 15s poll.
            const status = (err as { status?: number })?.status;
            if (status === 401 || status === 403) {
              setAuthed(false);
              setRole(null);
            }
            // Other network errors: keep the cached role to avoid
            // dropping nav items on a transient blip.
          });
      } else {
        setRole(null);
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
      <>
        {(role === "coach" || role === "admin") && (
          <NavLink to="/trainer" className={navLinkClass}>
            Trainer
          </NavLink>
        )}
        <NavLink to="/spieler" className={navLinkClass}>
          Spieler
        </NavLink>
        {role === "admin" && (
          <NavLink to="/admin/users" className={navLinkClass}>
            Benutzer
          </NavLink>
        )}
        <button
          className="app-nav__link"
          style={{ background: "transparent", border: "none", cursor: "pointer" }}
          onClick={() => {
            logout();
            nav("/login");
          }}
        >
          Abmelden
        </button>
      </>
    );
  }
  return (
    <NavLink to="/login" className={navLinkClass}>
      Anmelden
    </NavLink>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  // Globaler Gate vor allen geschützten Routen. Reagiert sofort auf
  // Login/Logout/Token-Ablauf (sessionStorage + storage events).
  const [authed, setAuthed] = useState<boolean>(isLoggedIn);
  const loc = useLocation();
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
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }
  return <>{children}</>;
}

function AuthedOnly({ children }: { children: React.ReactNode }) {
  // Wie RequireAuth, aber rendert einfach nichts statt zu navigieren -
  // für Nav-Links, die ohne Login unsichtbar sein sollen.
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

function AdminOnlyLink({ to, label }: { to: string; label: string }) {
  // Reaktiv auf Storage-Events (Login/Logout, Token-Ablauf) und auf das
  // 15s-Polling von AuthNavLink reagieren, damit der Reiter nicht "manchmal
  // da, manchmal weg" wirkt. Vorher wurde sessionStorage nur einmalig beim
  // Render gelesen.
  const [role, setRole] = useState<string | null>(() =>
    sessionStorage.getItem("user_role"),
  );
  useEffect(() => {
    const sync = () => setRole(sessionStorage.getItem("user_role"));
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    const id = window.setInterval(sync, 5000);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
      window.clearInterval(id);
    };
  }, []);
  if (role !== "admin") return null;
  return (
    <NavLink to={to} className={navLinkClass}>
      {label}
    </NavLink>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <div className="app-shell">
          <nav className="app-nav">
            <Link to="/" className="app-nav__brand">
              <span className="app-nav__brand-dot" aria-hidden />
              Coach Assistant
            </Link>
            <AuthedOnly>
              <NavLink to="/plaene" className={navLinkClass}>Pläne</NavLink>
            </AuthedOnly>
            <AdminOnlyLink to="/verfuegbarkeiten" label="Verfügbarkeiten" />
            <span className="app-nav__spacer" />
            <AuthNavLink />
          </nav>
          <Routes>
            <Route path="/login" element={<App><LoginPage /></App>} />
            <Route path="/" element={<RequireAuth><App><PlansLayout /></App></RequireAuth>}>
              <Route index element={<PlansPage />} />
            </Route>
            <Route path="/plaene" element={<RequireAuth><App><PlansLayout /></App></RequireAuth>}>
              <Route index element={<PlansPage />} />
              <Route path="vergleich" element={<PlanDiffView />} />
              <Route path="saisonwechsel" element={<ReplanWizard />} />
            </Route>
            <Route path="/plans/:planId" element={<RequireAuth><App><PlanDetailPage /></App></RequireAuth>} />
            <Route path="/verfuegbarkeiten" element={<RequireAuth><App><AvailabilityPage /></App></RequireAuth>} />
            <Route path="/trainer" element={<RequireAuth><App><CoachLayout /></App></RequireAuth>}>
              <Route index element={<CoachListPage />} />
              <Route path="profil" element={<CoachProfilePage />} />
              <Route path="bulk" element={<CoachEditorPage />} />
            </Route>
            <Route path="/spieler" element={<RequireAuth><App><PlayerLayout /></App></RequireAuth>}>
              <Route index element={<PlayerListPage />} />
              <Route path="profil" element={<PlayerProfilePage />} />
            </Route>
            <Route path="/chat" element={<RequireAuth><App><ChatPanel /></App></RequireAuth>} />
            <Route path="/admin/users" element={<RequireAuth><App><UsersAdminPage /></App></RequireAuth>} />
          </Routes>
          <ChatDock />
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
