import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Link } from "react-router-dom";
import { App } from "./App";
import { ChatPanel } from "./features/chat/ChatPanel";
import { PlansPage } from "./features/plan/PlansPage";
import { PlanDetailPage } from "./features/plan/PlanDetailPage";
import { PlanDiffView } from "./features/plan/PlanDiffView";
import { AvailabilityPage } from "./features/availability/AvailabilityPage";
import { CoachEditorPage } from "./features/coach/CoachEditorPage";
import { ReplanWizard } from "./features/replan/ReplanWizard";
import { LoginPage } from "./features/auth/LoginPage";

const qc = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <nav style={{ padding: 12, borderBottom: "1px solid #ddd", display: "flex", gap: 16, flexWrap: "wrap" }}>
          <Link to="/">Pläne</Link>
          <Link to="/availability">Verfügbarkeiten</Link>
          <Link to="/coaches">Trainer</Link>
          <Link to="/diff">Vergleich</Link>
          <Link to="/replan">Saisonwechsel</Link>
          <Link to="/chat">Chat</Link>
          <span style={{ flex: 1 }} />
          <Link to="/login">Anmelden</Link>
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
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
