import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { Badge, Icon, OperatorField } from "./components/ui";
import { api, operatorName, type ReviewQueue, type SystemStatus } from "./lib/api";
import DatasetsPage from "./pages/DatasetsPage";
import FairnessPage from "./pages/FairnessPage";
import ModelPage from "./pages/ModelPage";
import ReviewQueuePage from "./pages/ReviewQueuePage";
import NewSessionPage from "./pages/NewSessionPage";
import OverviewPage from "./pages/OverviewPage";
import ParticipantDetailPage from "./pages/ParticipantDetailPage";
import ParticipantsPage from "./pages/ParticipantsPage";
import RecordPage from "./pages/RecordPage";
import SessionDetailPage from "./pages/SessionDetailPage";
import SessionsPage from "./pages/SessionsPage";
import SettingsPage from "./pages/SettingsPage";
import SystemPage from "./pages/SystemPage";

const PAGE_TITLES: [RegExp, string][] = [
  [/^\/$/, "Overview"],
  [/^\/sessions\/new/, "New session"],
  [/^\/sessions\/[^/]+\/record/, "Live capture"],
  [/^\/sessions\/[^/]+/, "Session review"],
  [/^\/sessions/, "Sessions"],
  [/^\/participants/, "Participants"],
  [/^\/review/, "Review queue"],
  [/^\/model/, "Risk engine"],
  [/^\/fairness/, "Fairness and monitoring"],
  [/^\/datasets/, "Datasets"],
  [/^\/system/, "System health"],
  [/^\/settings/, "Settings"],
];

/** Light, real-data status for the top bar: API health and how many sessions await a reviewer. */
function useShellStatus() {
  const [health, setHealth] = useState<"ok" | "degraded" | "unknown">("unknown");
  const [needsReview, setNeedsReview] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      api.get<SystemStatus>("/system/status").then((d) => alive && setHealth(d.health.status === "ok" ? "ok" : "degraded")).catch(() => alive && setHealth("unknown"));
      api
        .get<ReviewQueue>("/review-queue?tier=HUMAN_REVIEW&limit=1")
        .then((d) => alive && setNeedsReview(d.total))
        .catch(() => alive && setNeedsReview(null));
    };
    load();
    const t = window.setInterval(load, 30000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);
  return { health, needsReview };
}

export default function App() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const recording = /^\/sessions\/[^/]+\/record$/.test(loc.pathname);
  const pageTitle = PAGE_TITLES.find(([re]) => re.test(loc.pathname))?.[1] ?? "ProctorStream";
  const { health, needsReview } = useShellStatus();
  const operator = operatorName();

  return (
    <div className="shell">
      <header className="app-header">
        <div className="topbar">
          <Link to="/" className="brand topbar-branding">
            <span className="brand-mark" aria-hidden>PS</span>
            <span className="brand-name">ProctorStream</span>
          </Link>
          <div className="topbar-title">
            <span className="topbar-dot" aria-hidden />
            <strong>{pageTitle}</strong>
          </div>
          <div className="topbar-right">
            <Link to="/system" className="topbar-chip" title="Open system health">
              <Badge tone={health === "ok" ? "ok" : health === "degraded" ? "bad" : "neutral"}>
                {health === "ok" ? "All systems healthy" : health === "degraded" ? "Service degraded" : "Status unknown"}
              </Badge>
            </Link>
            {needsReview != null && needsReview > 0 && (
              <Link to="/review" className="topbar-chip topbar-review">
                {needsReview} awaiting review
              </Link>
            )}
            <Link to="/settings" className="topbar-chip" title="Reviewer identity">
              <Icon name="user" size={16} /> {operator === "operator" ? "Set your name" : operator}
            </Link>
          </div>
        </div>

        <nav className="top-nav" aria-label="Main navigation">
          <div className="top-nav-group">
            <span className="top-nav-label">Monitor</span>
            <NavLink to="/" end><Icon name="overview" /> Overview</NavLink>
            <NavLink to="/sessions" end><Icon name="sessions" /> Sessions</NavLink>
            <NavLink to="/sessions/new"><Icon name="record" /> Live capture</NavLink>
            <NavLink to="/participants"><Icon name="people" /> Participants</NavLink>
          </div>
          <div className="top-nav-group">
            <span className="top-nav-label">Review</span>
            <NavLink to="/review"><Icon name="review" /> Review queue {needsReview ? <span className="nav-count">{needsReview}</span> : null}</NavLink>
          </div>
          <div className="top-nav-group">
            <span className="top-nav-label">Risk</span>
            <NavLink to="/model"><Icon name="model" /> Risk engine</NavLink>
            <NavLink to="/fairness"><Icon name="fairness" /> Fairness</NavLink>
          </div>
          <div className="top-nav-group">
            <span className="top-nav-label">Platform</span>
            <NavLink to="/datasets"><Icon name="data" /> Datasets</NavLink>
            <NavLink to="/system"><Icon name="system" /> System</NavLink>
            <NavLink to="/settings"><Icon name="settings" /> Settings</NavLink>
          </div>
        </nav>
      </header>

      <main className="main">
        <div className="page" style={recording ? { maxWidth: 1400 } : undefined}>
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/participants" element={<ParticipantsPage />} />
            <Route path="/participants/:id" element={<ParticipantDetailPage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/sessions/new" element={<NewSessionPage />} />
            <Route path="/sessions/:id" element={<SessionDetailPage />} />
            <Route path="/sessions/:id/record" element={<RecordPage />} />
            <Route path="/datasets" element={<DatasetsPage />} />
            <Route path="/review" element={<ReviewQueuePage />} />
            <Route path="/model" element={<ModelPage />} />
            <Route path="/fairness" element={<FairnessPage />} />
            <Route path="/system" element={<SystemPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<div className="empty"><h3>This page does not exist.</h3><Link to="/">Go to the overview</Link></div>} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
