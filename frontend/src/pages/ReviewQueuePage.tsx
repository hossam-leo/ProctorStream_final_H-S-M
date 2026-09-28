import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, DistributionBar, Empty, ErrorNotice, Loading, PageHeader, Panel, RiskBadge, StatGrid, useAsync } from "../components/ui";
import { api } from "../lib/api";
import { fmtDuration, fmtInt, fmtPct, REC_LABEL, recTone, titleCase } from "../lib/format";

interface Queue {
  total: number;
  counts: Record<string, number>;
  items: { session_id: string; risk: number; risk_level?: string; degraded?: boolean; recommendation: string; band: [number, number]; n_flags: number;
    source: string; status: string; participant_code: string | null; lighting: string; webcam_class: string;
    duration_s: number; top_reason: string | null }[];
}

export default function ReviewQueuePage() {
  const nav = useNavigate();
  const [tier, setTier] = useState("HUMAN_REVIEW");
  const [offset, setOffset] = useState(0);
  const q = useAsync(() => api.get<Queue>(`/review-queue?tier=${tier}&limit=50&offset=${offset}`), [tier, offset]);
  const summary = useAsync(() => api.get<{ reviews: number; overturn_rate: number | null }>("/reviews/summary"), []);
  const c = q.data?.counts ?? {};
  const scored = Object.values(c).reduce((a, b) => a + b, 0);
  return (
    <>
      <PageHeader
        title="Review queue"
        description="Sessions ordered by risk level from the deterministic rule engine. Work from the top; every decision is yours, the ordering only decides priority."
      />
      <StatGrid
        items={[
          { label: "Priority review", value: fmtInt(c.PRIORITY_REVIEW ?? 0), note: "High risk", tone: (c.PRIORITY_REVIEW ?? 0) > 0 ? "bad" : "ok" },
          { label: "Human review", value: fmtInt(c.HUMAN_REVIEW ?? 0), note: "Elevated risk", tone: (c.HUMAN_REVIEW ?? 0) > 0 ? "warn" : "ok" },
          { label: "Routine review", value: fmtInt(c.ROUTINE_REVIEW ?? 0), note: "Watch", tone: "info" },
          { label: "No action", value: fmtInt(c.NO_ACTION ?? 0), note: `${fmtInt(scored)} sessions scored`, tone: "ok" },
          { label: "Reviewed", value: fmtInt(summary.data?.reviews ?? 0),
            note: summary.data?.overturn_rate != null ? `${fmtPct(summary.data.overturn_rate)} found no concern` : "no decisions yet" },
        ]}
      />
      {scored > 0 && (
        <div style={{ margin: "18px 0" }}>
          <DistributionBar
            segments={[
              { label: "Normal", value: c.NO_ACTION ?? 0, tone: "ok" },
              { label: "Watch", value: c.ROUTINE_REVIEW ?? 0, tone: "info" },
              { label: "Elevated", value: c.HUMAN_REVIEW ?? 0, tone: "warn" },
              { label: "High", value: c.PRIORITY_REVIEW ?? 0, tone: "bad" },
            ]}
          />
        </div>
      )}
      <Panel flush className="" >
        <div className="filters">
          <div className="segmented" role="group" aria-label="Tier">
            {["PRIORITY_REVIEW", "HUMAN_REVIEW", "ROUTINE_REVIEW"].map((t) => (
              <button key={t} aria-pressed={tier === t} onClick={() => { setTier(t); setOffset(0); }}>
                {t === "ROUTINE_REVIEW" ? "All flagged" : t === "HUMAN_REVIEW" ? "Human and priority" : "Priority only"}
              </button>
            ))}
          </div>
          <span className="small muted">Simulated sessions in the sealed holdout are never shown.</span>
        </div>
        {q.loading && !q.data && <div style={{ padding: 16 }}><Loading /></div>}
        {q.error && <div style={{ padding: 16 }}><ErrorNotice message={q.error} onRetry={q.reload} /></div>}
        {q.data && q.data.items.length === 0 && <Empty title="Nothing waiting">No unreviewed sessions at this level.</Empty>}
        {q.data && q.data.items.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Session</th><th className="num">Risk level</th><th>Recommendation</th><th>Main reason</th><th>Conditions</th><th className="num">Length</th></tr>
                </thead>
                <tbody>
                  {q.data.items.map((i) => (
                    <tr key={i.session_id} className="clickable" onClick={() => nav(`/sessions/${i.session_id}`)}>
                      <td className="nowrap">{i.participant_code ?? i.session_id}<div className="small faint">{i.source === "MOCK" ? "Recorded" : "Simulated"}</div></td>
                      <td className="num"><RiskBadge level={i.risk_level} degraded={i.degraded} size="sm" /></td>
                      <td><Badge tone={recTone(i.recommendation)}>{REC_LABEL[i.recommendation]}</Badge></td>
                      <td className="small">{i.top_reason}</td>
                      <td className="small muted nowrap">{titleCase(i.lighting)} light, {i.webcam_class?.toUpperCase()}</td>
                      <td className="num">{fmtDuration(i.duration_s)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span className="num">{offset + 1}–{Math.min(offset + 50, q.data.total)} of {q.data.total.toLocaleString()}</span>
              <div className="row">
                <button className="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button>
                <button className="btn btn-sm" disabled={offset + 50 >= q.data.total} onClick={() => setOffset(offset + 50)}>Next</button>
              </div>
            </div>
          </>
        )}
      </Panel>
    </>
  );
}
