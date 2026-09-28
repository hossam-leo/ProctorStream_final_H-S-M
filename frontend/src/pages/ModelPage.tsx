import { ErrorNotice, Facts, Loading, PageHeader, Panel, RiskBadge, useAsync } from "../components/ui";
import { api } from "../lib/api";
import { titleCase } from "../lib/format";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;


export default function ModelPage() {
  const info = useAsync(() => api.get<Any>("/model-info"), []);
  const legacy = useAsync(() => api.get<Any>("/model/evaluation"), []);
  if (info.loading) return <Loading />;
  if (info.error || !info.data) return <ErrorNotice message={info.error ?? "No risk engine info"} onRetry={info.reload} />;
  const m = info.data;
  const legacyMetrics = legacy.data?.training?.primary?.validation;

  return (
    <>
      <PageHeader
        title="Risk engine"
        description={`Deterministic, configuration-driven rules — no learned model decides session risk. Engine ${m.model_version}, rules ${m.rules_version} (${m.rules_source}).`}
      />
      <Facts
        items={[
          { label: "Risk levels", value: m.risk_levels.join(" → ") },
          { label: "Rules configured", value: String(m.rules.length) },
          { label: "Multi-signal escalations", value: String(m.multi_flag_escalation.length) },
          {
            label: "Degraded when",
            value: `≥${m.degraded_mode.min_missing_for_degraded} of ${m.degraded_mode.critical_channels.length} critical channels missing`,
            note: m.degraded_mode.critical_channels.map(titleCase).join(", "),
          },
        ]}
      />

      <div style={{ marginTop: 20 }}>
        <Panel
          title="Recommendation mapping"
          description="Fixed 1:1 mapping from risk level to reviewer recommendation. There is no VIOLATION level — the system only ever recommends a level of human review."
        >
          <table className="table">
            <thead><tr><th>Risk level</th><th>Recommendation</th></tr></thead>
            <tbody>
              {m.risk_levels.map((lvl: string) => (
                <tr key={lvl}>
                  <td><RiskBadge level={lvl} size="sm" /></td>
                  <td>{m.recommendations[lvl]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <div style={{ marginTop: 20 }}>
        <Panel
          title="Rules"
          description="Every rule reacts to exactly one deterministic flag type. A rule never fires — and therefore never raises risk — for a channel that is missing from the session (see Degraded mode below). Edit configs/risk.yaml to change thresholds; no redeploy of code is required."
          flush
        >
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Rule</th><th>Flag type</th><th>Channel</th><th>Base level</th><th>Escalation</th><th>Description</th></tr>
              </thead>
              <tbody>
                {m.rules.map((r: Any) => (
                  <tr key={r.rule_id}>
                    <td className="small num nowrap">{r.rule_id}</td>
                    <td className="small">{r.flag_type}</td>
                    <td className="small muted">{titleCase(r.channel)}</td>
                    <td><RiskBadge level={r.base_level} size="sm" /></td>
                    <td className="small">
                      {r.escalate.length === 0 ? <span className="muted">—</span> : r.escalate.map((e: Any, i: number) => (
                        <div key={i}>
                          → <RiskBadge level={e.then_level} size="sm" />{" "}
                          {e.if_duration_s_gte != null && `if sustained ≥${e.if_duration_s_gte}s`}
                          {e.if_count_in_session_gte != null && `if ≥${e.if_count_in_session_gte} occurrences`}
                        </div>
                      ))}
                    </td>
                    <td className="small muted">{r.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="grid-2" style={{ marginTop: 20 }}>
        <Panel title="Multi-signal escalation" description="Applied after per-rule levels, on top of whatever the individual rules already produced.">
          {m.multi_flag_escalation.length === 0 ? <p className="muted">None configured.</p> : (
            <table className="table">
              <thead><tr><th>Condition</th><th>Minimum level</th></tr></thead>
              <tbody>
                {m.multi_flag_escalation.map((e: Any, i: number) => (
                  <tr key={i}>
                    <td className="small">≥{e.if_distinct_rule_types_gte} distinct rule types triggered</td>
                    <td><RiskBadge level={e.min_level} size="sm" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Legacy learned model (reference only)" description="Retained on disk for historical comparison. Not used to compute session risk in ProctorStream (SRS CON-8).">
          {legacy.loading && <Loading />}
          {!legacy.loading && !legacyMetrics && <p className="muted" style={{ margin: 0 }}>No legacy evaluation artifacts present in this environment.</p>}
          {legacyMetrics && (
            <table className="table">
              <tbody>
                <tr><td>PR-AUC (validation)</td><td className="num">{legacyMetrics.pr_auc?.toFixed(3)}</td></tr>
                <tr><td>Recall at operating point</td><td className="num">{legacyMetrics.recall != null ? `${(legacyMetrics.recall * 100).toFixed(1)}%` : "—"}</td></tr>
                <tr><td>False-positive rate</td><td className="num">{legacyMetrics.fpr != null ? `${(legacyMetrics.fpr * 100).toFixed(1)}%` : "—"}</td></tr>
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </>
  );
}
