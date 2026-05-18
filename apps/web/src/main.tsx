import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, NavLink, Link } from "react-router-dom";
import { App } from "./App";
import { ChatPanel } from "./features/chat/ChatPanel";
import { ChatDock } from "./features/chat/ChatDock";
import { PlansPage } from "./features/plan/PlansPage";
import { PlanDetailPage } from "./features/plan/PlanDetailPage";
import { PlanDiffView } from "./features/plan/PlanDiffView";
import { AvailabilityPage } from "./features/availability/AvailabilityPage";
import { CoachEditorPage } from "./features/coach/CoachEditorPage";
import { ReplanWizard } from "./features/replan/ReplanWizard";
import { LoginPage } from "./features/auth/LoginPage";
import "./index.css";

const qc = new QueryClient();

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  "app-nav__link" + (isActive ? " app-nav__link--active" : "");

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
            <NavLink to="/" end className={navLinkClass}>Pläne</NavLink>
            <NavLink to="/availability" className={navLinkClass}>Verfügbarkeiten</NavLink>
            <NavLink to="/coaches" className={navLinkClass}>Trainer</NavLink>
            <NavLink to="/diff" className={navLinkClass}>Vergleich</NavLink>
            <NavLink to="/replan" className={navLinkClass}>Saisonwechsel</NavLink>
            <span className="app-nav__spacer" />
            <NavLink to="/login" className={navLinkClass}>Anmelden</NavLink>
          </nav>
          <Routes>
            <Route path="/" element={<App><PlansPage /></App>} />
            <Route path="/plans/:planId" element={<App><PlanDetailPage /></App>} />
            <Route path="/availability" element={<App><AvailabilityPage /></App>} />
            <Route path="/coaches" element={<App><CoachEditorPage /></App>} />
            <Route path="/diff" element={<App><PlanDiffView /></App>} />
            <Route path="/replan" element={<App><ReplanWizard /></App>} />
            <Route path="/chat" element={<App><ChatPanel /></App>} />
            <Route path="/login" element={<App><LoginPage /></App>} />
          </Routes>
          <ChatDock />
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
