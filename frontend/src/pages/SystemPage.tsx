import { Badge, ErrorNotice, Loading, PageHeader, Panel, StatGrid, useAsync } from "../components/ui";
import { api, type Metrics, type SystemStatus } from "../lib/api";
import { fmtBytes, fmtDateTime, fmtInt, plainText, titleCase } from "../lib/format";

interface AuditRow { at: string; actor: string; action: string; entity_type: string; entity_id: string | null; details: Record<string, unknown> | null }

export default function SystemPage() {
  const st = useAsync(() => api.get<SystemStatus>("/system/status"), []);
  const metrics = useAsync(() => api.get<Metrics>("/metrics"), []);
  const audit = useAsync(() => api.get<AuditRow[]>("/audit?limit=50"), []);
  if (st.loading && !st.data) return <Loading />;
  if (st.error || !st.data) return <ErrorNotice message={st.error ?? ""} onRetry={st.reload} />;
  const d = st.data;
  return (
    <>
      <PageHeader
        title="System health"
        description="Is the platform healthy, what is it processing, and what is measured versus not yet instrumented in this build."
        actions={<button className="btn" onClick={() => { st.reload(); audit.reload(); metrics.reload(); }}>Refresh</button>}
      />
      <div className={`notice ${d.health.status === "ok" ? "notice-ok" : "notice-warn"}`} style={{ marginBottom: 20 }}>
        <strong>{d.health.status === "ok" ? "All services are healthy." : "One or more services are degraded."}</strong>{" "}
        {Object.entries(d.health.checks).map(([k, v]) => `${titleCase(k)}: ${v === "ok" ? "connected" : v}`).join(" · ")}
      </div>
      <Panel
        title="Pipeline metrics"
        description="Live counters from the metrics endpoint. Anything this environment cannot measure is marked, never shown as zero."
        actions={metrics.data && <span className="faint small">as of {fmtDateTime(metrics.data.time)}</span>}
      >
        {metrics.loading && !metrics.data ? (
          <Loading />
        ) : metrics.error || !metrics.data ? (
          <ErrorNotice message={metrics.error ?? "Metrics unavailable"} onRetry={metrics.reload} />
        ) : (
          <>
            <StatGrid
              items={[
                { label: "Active sessions", value: fmtInt(metrics.data.active_sessions), note: "in flight", tone: "accent" },
                { label: "Events processed", value: fmtInt(metrics.data.event_count_total), note: "accepted, all sessions" },
                {
                  label: "Rejected or dropped events",
                  value: fmtInt(metrics.data.dropped_or_rejected_events_total),
                  tone: metrics.data.dropped_or_rejected_events_total > 0 ? "warn" : "ok",
                  note: "failed validation or ingest",
                },
                {
                  label: "Unknown detector events",
                  value: fmtInt(metrics.data.detector_unknown_events_total),
                  note: "detector could not decide",
                },
                {
                  label: "Degraded sessions",
                  value: metrics.data.degraded_sessions == null ? <span className="unknown-tag">Not measured</span> : fmtInt(metrics.data.degraded_sessions),
                  note: "assessed with a missing channel",
                  tone: metrics.data.degraded_sessions ? "warn" : undefined,
                },
              ]}
            />
            <div className="three-col" style={{ marginTop: 18 }}>
              {[
                ["Queue depth", metrics.data.queue_depth, "", "No background job queue counter is wired up in this build."],
                ["Inference latency", metrics.data.inference_latency_ms, " ms", "Not benchmarked here; see the benchmark notes."],
                ["Ingest latency", metrics.data.ingest_latency_ms, " ms", "Not benchmarked here; see the benchmark notes."],
              ].map(([name, v, unit, why]) => (
                <div className="summary-strip" key={String(name)} style={{ gridTemplateColumns: "1fr" }}>
                  <div>
                    <div className="k">{name}</div>
                    <div className="v">{v == null ? <span className="unknown-tag">Not measured</span> : `${v}${unit}`}</div>
                    {v == null && <div className="faint small" style={{ marginTop: 6 }}>{why}</div>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Panel>
      <Panel title="Host resources" description="GPU, CPU, memory and worker telemetry." >
        <span className="unknown-tag">Not instrumented</span>
        <span className="muted" style={{ marginLeft: 10 }}>This build does not expose host resource telemetry, so nothing is charted here rather than showing invented values.</span>
      </Panel>
      <div style={{ height: 20 }} />
      <div className="grid-3">
        <Panel title="Service">
          <dl className="dl">
            <dt>API</dt><dd><Badge tone={d.health.status === "ok" ? "ok" : "bad"}>{d.health.status === "ok" ? "Healthy" : "Degraded"}</Badge></dd>
            {Object.entries(d.health.checks).map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}><dt>{titleCase(k)}</dt><dd>{v === "ok" ? "Connected" : v}</dd></div>
            ))}
            <dt>Version</dt><dd>{d.health.version}</dd>
            <dt>Schema revision</dt><dd>{d.schema_revision}</dd>
            <dt>Contracts</dt><dd>{d.health.contracts.join(", ")}</dd>
            <dt>Consent form</dt><dd>{d.consent_version}</dd>
          </dl>
        </Panel>
        <Panel title="Storage">
          <dl className="dl">
            <dt>Backend</dt><dd>{titleCase(d.storage.backend)} files</dd>
            <dt>Media stored</dt><dd className="num">{fmtBytes(d.storage.used_bytes)}</dd>
            <dt>Recordings kept</dt><dd className="num">{d.storage.stored_recordings}</dd>
          </dl>
        </Panel>
        <Panel title="Records">
          <dl className="dl">
            {Object.entries(d.row_counts).map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}><dt>{titleCase(k)}</dt><dd className="num">{fmtInt(v)}</dd></div>
            ))}
          </dl>
        </Panel>
      </div>
      <Panel title="Pipeline" description="Stages marked not built are planned for later phases and are not shown elsewhere in the product.">
        <table className="table">
          <tbody>
            {d.pipeline.map((p) => (
              <tr key={p.stage}>
                <td>{plainText(p.stage)}</td>
                <td style={{ textAlign: "right" }}>{p.state === "available" ? <Badge tone="ok">Available</Badge> : p.state === "not_installed" ? <Badge tone="warn">Not installed</Badge> : <Badge>Not built yet</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Audit log" description="Every consent, status change, upload, withdrawal and deletion, most recent first." flush>
        {audit.data && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th></tr></thead>
              <tbody>
                {audit.data.map((a, i) => (
                  <tr key={i}>
                    <td className="small nowrap">{fmtDateTime(a.at)}</td>
                    <td className="small">{a.actor}</td>
                    <td className="small">{a.action}{a.details && "to" in a.details ? `: ${String(a.details.to).toLowerCase()}` : ""}</td>
                    <td className="small muted">{a.entity_type} {a.entity_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
