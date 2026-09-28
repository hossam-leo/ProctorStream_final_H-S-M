import { useEffect, useState } from "react";
import { API, api, type Assessment, type Job, type SessionDetail } from "../lib/api";
import { fmtClock, fmtDateTime, REC_LABEL, recTone, riskTone, titleCase, VERDICT_LABEL } from "../lib/format";
import { Badge, Field, Panel, RiskBadge, useToast } from "./ui";

const VERDICTS = ["NO_CONCERN", "INCONCLUSIVE", "CONCERN_CONFIRMED"] as const;

export function AssessmentPanel({
  session,
  onChange,
  assessment,
  assessmentLoading,
  reloadAssessment,
  hasVideo,
  onSeekMs,
  activeFlagId,
  onSelectFlag,
}: {
  session: SessionDetail;
  onChange: () => void;
  /** Fetched once by the page so the timeline, summary and this panel all read the same assessment. */
  assessment: Assessment | null;
  assessmentLoading: boolean;
  reloadAssessment: () => void;
  hasVideo: boolean;
  onSeekMs: (ms: number) => void;
  activeFlagId: string | null;
  onSelectFlag: (id: string | null) => void;
}) {
  const toast = useToast();
  const sealed = session.source === "SIMULATED" && session.split === "holdout";
  const ra = { data: assessment, loading: assessmentLoading, reload: reloadAssessment };
  const [showAll, setShowAll] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [verdict, setVerdict] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const canProcess = session.source === "MOCK" && ["UPLOADED", "FAILED", "COMPLETED", "REVIEWED"].includes(session.status) &&
    session.recordings.some((r) => r.kind === "webcam_av" && r.status === "STORED");

  useEffect(() => {
    if (session.source !== "MOCK") return;
    let alive = true;
    let timer = 0;
    const poll = async () => {
      const j = await api.get<Job | null>(`/sessions/${session.id}/job`).catch(() => null);
      if (!alive) return;
      setJob(j);
      if (j && (j.status === "QUEUED" || j.status === "RUNNING")) timer = window.setTimeout(poll, 1500);
      else if (j && session.status === "PROCESSING") onChange();
    };
    void poll();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [session.id, session.status, session.source, onChange]);

  async function analyze() {
    setBusy(true);
    try {
      await api.post(`/sessions/${session.id}/process`);
      toast("Analysis started. This takes about a minute per 30 minutes of video.");
      onChange();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function review() {
    setBusy(true);
    try {
      await api.post(`/sessions/${session.id}/review`, { verdict, note: note.trim() || null });
      toast("Review saved.");
      setVerdict("");
      setNote("");
      ra.reload();
      onChange();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  const running = job && (job.status === "QUEUED" || job.status === "RUNNING");
  const a = ra.data;
  return (
    <Panel
      title="Risk assessment"
      description="A deterministic, rule-based recommendation for a human reviewer. It is never a finding of misconduct."
      actions={
        <>
          {a && <a className="btn btn-sm" href={`${API}/sessions/${session.id}/report`} target="_blank" rel="noreferrer">Reviewer report</a>}
          {canProcess && !running && (
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={analyze}>
              {a ? "Analyse again" : "Analyse recording"}
            </button>
          )}
        </>
      }
    >
      {sealed && <p className="muted" style={{ margin: 0 }}>Sealed holdout: not scored in the dashboard.</p>}
      {running && (
        <div>
          <div className="row small" style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <span>{job.stage ?? "Queued"}</span>
            <span className="num">{Math.round(job.progress * 100)}%</span>
          </div>
          <div className="progress"><span style={{ width: `${job.progress * 100}%` }} /></div>
        </div>
      )}
      {job?.status === "FAILED" && !running && (
        <div className="notice notice-bad" style={{ marginBottom: 12 }}>
          <strong>The last analysis failed.</strong>
          {job.message}
        </div>
      )}
      {!sealed && !running && !a && !ra.loading && (
        <p className="muted" style={{ margin: 0 }}>
          {session.source === "MOCK"
            ? canProcess ? "Not analysed yet. Analysing runs the detectors on the recording, then the rule-based risk engine." : "Upload the recording first."
            : "No assessment stored for this session."}
        </p>
      )}
      {a && !running && (
        <div className="stack">
          <div className="row" style={{ gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <RiskBadge level={a.risk_level} degraded={a.degraded} size="lg" />
            <Badge tone={recTone(a.recommendation)}>{REC_LABEL[a.recommendation]}</Badge>
            <span className="small muted num">display band {a.confidence_band[0].toFixed(2)}–{a.confidence_band[1].toFixed(2)}</span>
          </div>
          <div className="summary-strip">
            <div><div className="k">Risk level</div><div className="v">{titleCase(a.risk_level)}</div></div>
            <div><div className="k">Recommendation</div><div className="v">{REC_LABEL[a.recommendation]}</div></div>
            <div><div className="k">Flags</div><div className="v num">{a.flags.length}</div></div>
            <div><div className="k">Channels available</div><div className="v num">{a.channels_available.length}</div></div>
            <div><div className="k">Channels missing</div><div className="v num">{a.channels_missing.length}</div></div>
          </div>
          {a.degraded && (
            <div className="notice notice-warn"><strong>Degraded — incomplete evidence.</strong> A critical channel was unavailable, so this assessment rests on less than the full signal set.</div>
          )}
          <div>
            <h3 style={{ marginBottom: 6 }}>Why</h3>
            {a.top_contributors.length === 0 && <p className="small muted" style={{ margin: 0 }}>No rule fired — nothing to review.</p>}
            <ul style={{ margin: 0, paddingLeft: 18 }} className="small">
              {a.top_contributors.map((c) => (
                <li key={c.rule_id} style={{ marginBottom: 4 }}>
                  <span className="small faint num">[{c.rule_id}]</span> {c.explanation}
                </li>
              ))}
            </ul>
          </div>
          {a.flags.length > 0 && (
            <div>
              <h3 style={{ marginBottom: 8 }}>Flags and evidence</h3>
              <p className="small muted" style={{ margin: "0 0 10px" }}>
                Each flag shows how it was reached: the detected event, the rule that evaluated it, the flag it produced, and the recording it points to.
              </p>
              <div className="flag-list">
                {(showAll ? a.flags : a.flags.slice(0, 6)).map((f) => {
                  const lvl = f.resulting_level;
                  const active = activeFlagId === f.flag_id;
                  return (
                    <div
                      key={f.flag_id}
                      className={`flag-card risk-tone-${riskTone(lvl)} ${active ? "active" : ""}`}
                      onClick={() => onSelectFlag(active ? null : f.flag_id)}
                    >
                      <div className="flag-head">
                        <span className="flag-title">{titleCase(f.type)}</span>
                        <span className="row" style={{ gap: 8 }}>
                          {lvl && <RiskBadge level={lvl} size="sm" />}
                          <span className="small muted num" title="Detector confidence">conf. {f.confidence.toFixed(2)}</span>
                        </span>
                      </div>
                      <div className="flag-meta">
                        <span className="num">{fmtClock(f.t_start_ms)}–{fmtClock(f.t_end_ms)}</span>
                        {f.duration_s != null && <span className="num">{f.duration_s} s</span>}
                        {f.channel && <span className="pill">{titleCase(f.channel)}</span>}
                      </div>
                      <div className="small">{f.explanation}</div>
                      <div className="chain" aria-label="How this flag was reached">
                        <span className="chain-node">Event <code>{(f.triggering_events ?? [f.flag_id]).join(", ")}</code></span>
                        <span className="chain-arrow" aria-hidden>→</span>
                        <span className="chain-node">Rule <code>{f.rule_id ?? "—"}</code></span>
                        <span className="chain-arrow" aria-hidden>→</span>
                        <span className="chain-node">Flag <code>{f.flag_id}</code></span>
                        <span className="chain-arrow" aria-hidden>→</span>
                        {f.evidence_ref && hasVideo ? (
                          <button
                            className="btn btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectFlag(f.flag_id);
                              onSeekMs(f.t_start_ms);
                            }}
                          >
                            Evidence: play {fmtClock(f.t_start_ms)}
                          </button>
                        ) : (
                          <span className="chain-node">{f.evidence_ref ? "Evidence: recording not stored" : "Evidence: none referenced"}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {a.flags.length > 6 && (
                <button className="btn btn-sm btn-ghost" style={{ marginTop: 10 }} onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Show fewer" : `Show all ${a.flags.length} flags`}
                </button>
              )}
            </div>
          )}
          {(a.channels_available.length > 0 || a.channels_missing.length > 0) && (
            <div>
              <h3 style={{ marginBottom: 6 }}>Signal coverage</h3>
              <div className="channel-pills">
                {a.channels_available.map((c) => <span key={c} className="pill pill-ok">{titleCase(c)}</span>)}
                {a.channels_missing.map((c) => <span key={c} className="pill pill-miss" title="Unavailable for this session">{titleCase(c)} · unavailable</span>)}
              </div>
              {a.channels_missing.length > 0 && <p className="small muted" style={{ margin: "8px 0 0" }}>Missing signals never raise the risk level.</p>}
            </div>
          )}
          <div>
            <h3 style={{ marginBottom: 6 }}>Reviewer decision</h3>
            {(a.reviews ?? []).map((r, i) => (
              <p key={i} className="small" style={{ margin: "0 0 4px" }}>
                <Badge plain tone={r.verdict === "CONCERN_CONFIRMED" ? "warn" : "neutral"}>{VERDICT_LABEL[r.verdict]}</Badge>{" "}
                {r.reviewer}, {fmtDateTime(r.created_at)}{r.note ? `: ${r.note}` : ""}
              </p>
            ))}
            <div className="segmented" role="group" aria-label="Verdict" style={{ margin: "6px 0 10px" }}>
              {VERDICTS.map((v) => (
                <button key={v} aria-pressed={verdict === v} onClick={() => setVerdict(v)}>{VERDICT_LABEL[v]}</button>
              ))}
            </div>
            <Field label="Note" htmlFor="rnote" hint="What you saw in the recording. Kept separate from the training labels.">
              <textarea id="rnote" className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <button className="btn btn-primary btn-sm" disabled={!verdict || busy} onClick={review}>Save decision</button>
          </div>
          <p className="small faint" style={{ margin: 0 }}>rule engine {a.model_version}, features {a.feature_version}</p>
        </div>
      )}
    </Panel>
  );
}
