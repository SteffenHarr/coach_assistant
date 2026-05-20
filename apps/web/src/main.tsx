import React from "react";
import ReactDOM from "react-dom/client";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, NavLink, Link, useNavigate } from "react-router-dom";
import { App } from "./App";
import { ChatPanel } from "./features/chat/ChatPanel";
import { ChatDock } from "./features/chat/ChatDock";
import { PlansPage } from "./features/plan/PlansPage";
import { PlanDetailPage } from "./features/plan/PlanDetailPage";
import { PlanDiffView } from "./features/plan/PlanDiffView";
import { AvailabilityPage } from "./features/availability/AvailabilityPage";
import { CoachEditorPage } from "./features/coach/CoachEditorPage";
import { CoachProfilePage } from "./features/coach/CoachProfilePage";
import { PlayerListPage } from "./features/player/PlayerListPage";
import { PlayerProfilePage } from "./features/player/PlayerProfilePage";
import { ReplanWizard } from "./features/replan/ReplanWizard";
import { LoginPage } from "./features/auth/LoginPage";
import { UsersAdminPage } from "./features/admin/UsersAdminPage";
import { PlansLayout, CoachLayout, PlayerLayout } from "./features/nav/Layouts";
import { isLoggedIn, logout, api } from "./api/client";
import "./index.css";

const qc = new QueryClient();

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  "app-nav__link" + (isActive ? " app-nav__link--active" : "");

function AuthNavLink() {
  const [authed, setAuthed] = useState<boolean>(isLoggedIn);
  const [role, setRole] = useState<string | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    const refresh = () => {
      const ok = isLoggedIn();
      setAuthed(ok);
      if (ok) {
        api<{ role: string }>("/me")
          .then((u) => setRole(u.role))
          .catch(() => setRole(null));
      } else {
        setRole(null);
      }
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    const id = window.setInterval(refresh, 5000);
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
            <NavLink to="/plaene" className={navLinkClass}>Pläne</NavLink>
            <NavLink to="/verfuegbarkeiten" className={navLinkClass}>Verfügbarkeiten</NavLink>
            <span className="app-nav__spacer" />
            <AuthNavLink />
          </nav>
          <Routes>
            <Route path="/" element={<App><PlansLayout /></App>}>
              <Route index element={<PlansPage />} />
            </Route>
            <Route path="/plaene" element={<App><PlansLayout /></App>}>
              <Route index element={<PlansPage />} />
              <Route path="vergleich" element={<PlanDiffView />} />
              <Route path="saisonwechsel" element={<ReplanWizard />} />
            </Route>
            <Route path="/plans/:planId" element={<App><PlanDetailPage /></App>} />
            <Route path="/verfuegbarkeiten" element={<App><AvailabilityPage /></App>} />
            <Route path="/trainer" element={<App><CoachLayout /></App>}>
              <Route index element={<CoachEditorPage />} />
              <Route path="profil" element={<CoachProfilePage />} />
            </Route>
            <Route path="/spieler" element={<App><PlayerLayout /></App>}>
              <Route index element={<PlayerListPage />} />
              <Route path="profil" element={<PlayerProfilePage />} />
            </Route>
            <Route path="/chat" element={<App><ChatPanel /></App>} />
            <Route path="/login" element={<App><LoginPage /></App>} />
            <Route path="/admin/users" element={<App><UsersAdminPage /></App>} />
          </Routes>
          <ChatDock />
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
