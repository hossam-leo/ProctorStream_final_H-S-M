import { Link, useNavigate } from "react-router-dom";
import { CoverageSummary } from "../components/Coverage";
import { Badge, DistributionBar, Empty, ErrorNotice, Loading, PageHeader, Panel, StatGrid, StatusBadge, useAsync } from "../components/ui";
import { api, type Coverage, type Metrics, type ReviewQueue, type SessionStatus, type SystemStatus } from "../lib/api";
import { fmtDateTime, fmtDuration, fmtInt, fmtPct } from "../lib/format";

interface Overview {
  counts: Record<string, Record<string, number>>;
  mock_needs_upload: number;
  mock_coverage: Coverage;
  recent_mock_sessions: {
    id: string;
    status: SessionStatus;
    script_id: string;
    created_at: string;
    participant_code: string;
    is_rehearsal: boolean;
    duration_s: number | null;
  }[];
  activity: { at: string; actor: string; action: string; entity_type: string; entity_id: string | null }[];
  datasets: { id: string; n_sessions: number; positive_rate: number; noise_source: string }[];
}

const ACTION_TEXT: Record<string, string> = {
  "participant.create": "registered a participant",
  "consent.sign": "recorded consent",
  "participant.withdraw": "processed a withdrawal",
  "session.create": "created a session",
  "session.status": "changed a session status",
  "recording.upload": "uploaded a recording",
  "dataset.register": "registered a dataset",
  "demographics.set": "saved optional details",
};

export default function OverviewPage() {
  const nav = useNavigate();
  const { data, error, loading, reload } = useAsync(() => api.get<Overview>("/overview"), []);
  const model = useAsync(
    () => api.get<{ model_version: string; rules_version: string; rules: unknown[] }>("/model-info").catch(() => null),
    [],
  );
  // Secondary, real-data sources. Each degrades independently to an explicit "unknown" state.
  const metrics = useAsync(() => api.get<Metrics>("/metrics").catch(() => null), []);
  const queue = useAsync(() => api.get<ReviewQueue>("/review-queue?tier=ROUTINE_REVIEW&limit=1").catch(() => null), []);
  const sys = useAsync(() => api.get<SystemStatus>("/system/status").catch(() => null), []);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNotice message={error ?? "No data"} onRetry={reload} />;

  const recorded = data.counts.MOCK ?? {};
  const recordedTotal = Object.values(recorded).reduce((a, b) => a + b, 0) - (recorded.DELETED ?? 0);
  const simulated = data.datasets.reduce((a, d) => a + d.n_sessions, 0);
  const cov = data.mock_coverage;
  const qc = queue.data?.counts ?? null;
  const awaiting = qc ? (qc.HUMAN_REVIEW ?? 0) + (qc.PRIORITY_REVIEW ?? 0) : null;
  const health = sys.data?.health.status;

  return (
    <>
      <PageHeader
        title="Operations overview"
        description="What is happening now, what needs a reviewer, and whether the platform is healthy."
        actions={
          <>
            <button className="btn" onClick={() => { reload(); metrics.reload(); queue.reload(); sys.reload(); }}>Refresh</button>
            <Link className="btn" to="/review">Review queue</Link>
            <Link className="btn btn-primary" to="/sessions/new">New session</Link>
          </>
        }
      />
      {data.mock_needs_upload > 0 && (
        <div className="notice notice-warn" style={{ marginBottom: 20 }}>
          <strong>
            {data.mock_needs_upload} {data.mock_needs_upload === 1 ? "recording is" : "recordings are"} waiting for upload.
          </strong>
          Open the session and upload it from the same browser before closing it, or the recording is lost.{" "}
          <Link to="/sessions?status=RECORDED">Show sessions</Link>
        </div>
      )}
      <StatGrid
        items={[
          {
            label: "Active sessions",
            value: metrics.data ? fmtInt(metrics.data.active_sessions) : <span className="faint">—</span>,
            note: metrics.data ? "recording, uploading or analysing" : "metrics unavailable",
            tone: "accent",
          },
          {
            label: "Awaiting review",
            value: awaiting != null ? fmtInt(awaiting) : <span className="faint">—</span>,
            note: awaiting != null ? "human or priority review, not yet reviewed" : "review queue unavailable",
            tone: awaiting ? "warn" : "ok",
          },
          {
            label: "Priority review",
            value: qc ? fmtInt(qc.PRIORITY_REVIEW ?? 0) : <span className="faint">—</span>,
            note: "highest-risk sessions",
            tone: qc && (qc.PRIORITY_REVIEW ?? 0) > 0 ? "bad" : "ok",
          },
          {
            label: "Total sessions",
            value: fmtInt(recordedTotal + simulated),
            note: `${fmtInt(recordedTotal)} recorded · ${fmtInt(simulated)} simulated`,
          },
          {
            label: "Platform health",
            value: health ? (health === "ok" ? "Healthy" : "Degraded") : "Unknown",
            note: sys.data ? `v${sys.data.health.version}` : "status endpoint unavailable",
            tone: health === "ok" ? "ok" : health ? "bad" : undefined,
          },
        ]}
      />
      <div className="two-col" style={{ marginTop: 20 }}>
        <Panel
          title="Risk distribution"
          description="Every assessed session, by the recommendation the risk engine made. Higher tiers need a person to look."
          actions={<Link to="/review" className="btn btn-sm">Open queue</Link>}
        >
          {qc == null ? (
            <span className="unknown-tag">Unknown — risk distribution could not be loaded</span>
          ) : Object.values(qc).reduce((a, b) => a + b, 0) === 0 ? (
            <Empty title="No sessions have been assessed yet">Risk levels appear here once a recording has been analysed.</Empty>
          ) : (
            <DistributionBar
              segments={[
                { label: "Normal · no action", value: qc.NO_ACTION ?? 0, tone: "ok" },
                { label: "Watch · routine review", value: qc.ROUTINE_REVIEW ?? 0, tone: "info" },
                { label: "Elevated · human review", value: qc.HUMAN_REVIEW ?? 0, tone: "warn" },
                { label: "High · priority review", value: qc.PRIORITY_REVIEW ?? 0, tone: "bad" },
              ]}
            />
          )}
        </Panel>
        <Panel title="Live system status" actions={<Link to="/system" className="btn btn-sm">System health</Link>}>
          {metrics.data ? (
            <div>
              <div className="metric-row"><span className="metric-name">Events processed</span><span className="metric-val">{fmtInt(metrics.data.event_count_total)}</span></div>
              <div className="metric-row"><span className="metric-name">Rejected or dropped events</span><span className="metric-val">{fmtInt(metrics.data.dropped_or_rejected_events_total)}</span></div>
              <div className="metric-row">
                <span className="metric-name">Degraded sessions</span>
                <span className="metric-val">{metrics.data.degraded_sessions == null ? <span className="unknown-tag">Not measured</span> : fmtInt(metrics.data.degraded_sessions)}</span>
              </div>
              <div className="metric-row">
                <span className="metric-name">Processing queue</span>
                <span className="metric-val">{metrics.data.queue_depth == null ? <span className="unknown-tag">Not measured</span> : fmtInt(metrics.data.queue_depth)}</span>
              </div>
              <div className="metric-row">
                <span className="metric-name">Risk engine</span>
                <span className="metric-val" style={{ fontSize: 14 }}>
                  {model.data ? <Badge tone="info" plain>{model.data.model_version}</Badge> : <span className="unknown-tag">Unavailable</span>}
                </span>
              </div>
            </div>
          ) : (
            <span className="unknown-tag">Unavailable — live metrics could not be loaded</span>
          )}
        </Panel>
      </div>
      <div className="grid-2" style={{ marginTop: 20 }}>
        <Panel
          title="Recent sessions"
          actions={
            <Link to="/sessions?source=MOCK" className="btn btn-sm">
              All sessions
            </Link>
          }
          flush
        >
          {data.recent_mock_sessions.length === 0 ? (
            <Empty title="No sessions recorded yet" action={<Link className="btn btn-primary" to="/sessions/new">Record the first session</Link>}>
              Register a participant, record their consent, then start a session.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Participant</th>
                    <th>Script</th>
                    <th>Status</th>
                    <th className="num">Length</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_mock_sessions.map((s) => (
                    <tr key={s.id} className="clickable" onClick={() => nav(`/sessions/${s.id}`)}>
                      <td>{s.participant_code}</td>
                      <td>
                        {s.script_id}
                        {s.is_rehearsal && <span className="faint small"> (rehearsal)</span>}
                      </td>
                      <td>
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="num">{fmtDuration(s.duration_s)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title="Recent activity" flush>
          {data.activity.length === 0 ? (
            <Empty title="Nothing has happened yet" />
          ) : (
            <table className="table">
              <tbody>
                {data.activity.map((a, i) => (
                  <tr key={i}>
                    <td className="small">
                      <strong>{a.actor}</strong> {ACTION_TEXT[a.action] ?? a.action}
                    </td>
                    <td className="small muted nowrap" style={{ textAlign: "right" }}>
                      {fmtDateTime(a.at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Recorded corpus coverage" description={`${cov.eligible_sessions} of ${cov.target_sessions} target sessions · ${fmtInt(cov.active_participants)} consenting participants (${cov.participants_recorded} recorded). Sessions by lighting and webcam condition.`}>
          <CoverageSummary c={cov} />
        </Panel>
        <Panel title="Simulated datasets" actions={<Link to="/datasets" className="btn btn-sm">Datasets</Link>} flush>
          {data.datasets.length === 0 ? (
            <Empty title="No simulated dataset registered">
              Generate one with <span className="code">make simulate</span>, then register it.
            </Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th className="num">Sessions</th>
                  <th className="num">Violations</th>
                </tr>
              </thead>
              <tbody>
                {data.datasets.map((d) => (
                  <tr key={d.id}>
                    <td>{d.id}</td>
                    <td className="num">{fmtInt(d.n_sessions)}</td>
                    <td className="num">{fmtPct(d.positive_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </>
  );
}
