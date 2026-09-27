# Risk engine

ProctorStream's session risk decision is made by a **deterministic, configuration-driven rule engine**
(`src/proctorstream/risk_engine/`), not a trained/learned model. This is a hard SRS constraint (CON-8) and is
enforced structurally, not just by convention:

- The engine has no `fit`/`train` method, loads no model weights, and performs no calibration.
- Its only inputs are: the flags produced by deterministic threshold logic
  (`proctorstream.features.engine.generate_flags`), which channels had usable evidence for the session, and
  `configs/risk.yaml`. Given the same three inputs it always produces the same output (`tests/unit/test_risk_engine.py::test_engine_is_deterministic`).
- `configs/risk.yaml` is the single source of truth for thresholds. Changing a threshold or adding a rule is a
  config edit, not a code change or redeploy (NFR-11).

## Pipeline position

```
event.v1 events  →  per-second grid + threshold-based flags (features/engine.py, unchanged threshold logic)
                 →  RuleEngine.assess()  (risk_engine/engine.py)
                 →  session_result.v1
```

`generate_flags` was already deterministic and threshold-based before this rework (see `FLAG_RULES` in
`src/proctorstream/features/engine.py`) — it is reused as-is. What changed is the step after it: previously a trained
LightGBM/ROCKET model (`proctorstream.modeling.model.RiskModel`) turned features into a calibrated probability; now
`RuleEngine` turns flags into a `risk_level` by table lookup against `configs/risk.yaml`. The legacy model is kept
under `src/proctorstream/modeling/` and `models/trained/` for historical comparison only (see `docs/MODELS.md`) and is
not on this call path.

## Rule shape

Each rule in `configs/risk.yaml` binds to exactly one flag type and one channel:

```yaml
- rule_id: RULE-PHONE-01
  flag_type: PHONE_USE
  channel: environment
  base_level: ELEVATED
  escalate:
    - if_duration_s_gte: 30
      then_level: HIGH
  description: "A mobile phone or similar device was visible in the candidate's camera frame."
```

A rule fires once per flag *instance* of its type, at `base_level`, then checks its `escalate` list: if any
condition (`if_duration_s_gte` — how long that flag instance lasted; `if_count_in_session_gte` — how many
instances of that flag type occurred anywhere in the session) is met, the level is raised to `then_level` (never
lowered). The session's `risk_level` is the maximum level reached by any triggered rule.

On top of that, `session_aggregation.multi_flag_escalation` can raise the session level further when several
*independent* concern types co-occur (e.g. 3+ distinct rule types → at least ELEVATED), even if no single one
reached that level alone — catching sessions with several small concerns that are individually inconclusive but
collectively worth a closer look.

## Missing evidence never raises risk (FR-30/FR-33)

This is enforced structurally: a rule is only evaluated `if rule.channel in channels_available`. If a flag's
channel is in `channels_missing`, that flag is moved to `suppressed_missing_channel_flags` on the session result
and contributes nothing to `risk_level` — there is no numeric score for "missing" to leak into. This is covered by
`test_missing_channel_never_increases_risk` and `test_missing_channels_never_appear_as_evidence_in_any_output_list`
in the unit tests, which assert that the *identical* evidence produces `HIGH` when its channel is available and
`NORMAL` when the channel is missing.

## Degraded sessions

Separately from risk, a session is marked `degraded: true` when `degraded_mode.min_missing_for_degraded` or more
of `degraded_mode.critical_channels` are unavailable — this tells a reviewer the assessment rests on incomplete
evidence, without implying anything about risk itself (a degraded session can still be NORMAL, and a
non-degraded session can still be HIGH).

## Explainability

Every entry in `session_result.v1["flags"]` carries: `rule_id`, `channel`, the time window (`t_start_ms`/`t_end_ms`),
`confidence`, the `resulting_level`, a human-readable `explanation`, and `evidence_ref` (a pointer into the session
recording/grid). This is enough for a reviewer to go from "why is this HIGH" to the exact rule and moment in the
recording without needing to understand the underlying detector math.

**Known limitation:** `triggering_events` on a flag currently references the flag's own ID, not the individual raw
`event.v1` records that produced it. Flags are aggregates over a rolling window of many events (see
`generate_flags`), so there is no single raw event to point to; `evidence_ref` is the mechanism for pointing a
reviewer at the relevant moment in the recording instead.

## What is NOT configurable

`risk_levels` (`NORMAL`/`WATCH`/`ELEVATED`/`HIGH`) and the *set* of `recommendations`
(`NO_ACTION`/`ROUTINE_REVIEW`/`HUMAN_REVIEW`/`PRIORITY_REVIEW`) are fixed by the SRS and validated at load time
(`RiskConfig` in `risk_engine/config.py` raises `RiskConfigError` if they don't match exactly, including an explicit
check that rejects a `VIOLATION` level). Everything else — which flags map to which rules, thresholds, escalation,
degraded-mode policy — is configuration.

## Testing

`tests/unit/test_risk_engine.py` (15 tests, run and passing in this environment — see `FINAL_STATUS.md`) covers:
config validation and rejection of malformed/non-compliant configs, baseline NORMAL/NO_ACTION behaviour, individual
rule triggering and duration/count-based escalation, the missing-channel guarantee, multi-signal escalation,
degraded-mode flagging, and determinism.
