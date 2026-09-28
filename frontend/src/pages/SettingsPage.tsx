import { Link } from "react-router-dom";
import { Badge, ErrorNotice, Loading, OperatorField, PageHeader, Panel, useAsync } from "../components/ui";
import { api, type SystemStatus } from "../lib/api";
import { fmtBytes, titleCase } from "../lib/format";

/** Workspace settings. Only settings that actually exist are editable here (the operator name is
 * stored in the browser and sent with each audited action). Everything else is shown read-only,
 * because capture, thresholds and risk rules are versioned server-side configuration, not UI state. */
export default function SettingsPage() {
  const st = useAsync(() => api.get<SystemStatus>("/system/status"), []);
  return (
    <>
      <PageHeader
        title="Settings"
        description="Your reviewer identity and a read-only view of how this workspace is configured."
      />
      <div className="two-col">
        <div style={{ display: "grid", gap: 18 }}>
          <Panel title="Reviewer identity" description="Recorded in the audit log next to every review, analysis and status change you make.">
            <OperatorField label="Operator name" />
            <p className="faint" style={{ marginTop: 10, marginBottom: 0 }}>
              Stored in this browser only. Without a name, actions are recorded as “operator”.
            </p>
          </Panel>
          <Panel title="Capture and consent" description="Fixed by the consent form version and the configured recording flow.">
            {st.loading && !st.data ? (
              <Loading />
            ) : st.error || !st.data ? (
              <ErrorNotice message={st.error ?? ""} onRetry={st.reload} />
            ) : (
              <dl className="dl">
                <dt>Consent form version</dt>
                <dd>{st.data.consent_version}</dd>
                <dt>Signal channels</dt>
                <dd>
                  <div className="channel-pills">
                    {st.data.channels.map((c) => (
                      <span className="pill" key={c}>{titleCase(c)}</span>
                    ))}
                  </div>
                </dd>
              </dl>
            )}
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 18 }}>
          <Panel title="Workspace">
            {st.data ? (
              <dl className="dl">
                <dt>API status</dt>
                <dd><Badge tone={st.data.health.status === "ok" ? "ok" : "bad"}>{st.data.health.status === "ok" ? "Healthy" : "Degraded"}</Badge></dd>
                <dt>Version</dt>
                <dd>{st.data.health.version}</dd>
                <dt>Storage</dt>
                <dd>{titleCase(st.data.storage.backend)} files · {fmtBytes(st.data.storage.used_bytes)}</dd>
                <dt>Schema revision</dt>
                <dd>{st.data.schema_revision}</dd>
              </dl>
            ) : (
              <span className="faint">Unavailable</span>
            )}
          </Panel>
          <Panel title="Risk rules and thresholds">
            <p className="muted" style={{ marginTop: 0 }}>
              Rules, thresholds and recommendation mapping come from versioned server configuration and are shown, with their live values, on the Risk engine page.
            </p>
            <Link className="btn btn-sm" to="/model">Open Risk engine</Link>
          </Panel>
        </div>
      </div>
    </>
  );
}
