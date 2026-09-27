# Event contracts

ProctorStream uses three versioned, schema-validated contracts. JSON Schema files (generated from
`proctorstream.contracts`, the single source of truth) live in `contracts/`; regenerate with
`python -m proctorstream.contracts --write` or `proctorstream schemas`.

## `event.v1` — `contracts/event.v1.schema.json`

Emitted by every Tier 1/Tier 2 detector. Required fields: `schema`, `session_id`, `ts_ms`, `channel`, `detector`,
`detector_version`, `event_type`, `payload`, `confidence`. `quality` is optional (frame blur/luma/usability).

`channel` is one of the 11 signal channels (`presence`, `identity`, `liveness`, `attention`, `environment`, `pose`,
`audio_voice`, `audio_event`, `screen`, `device`, `behavioral`). `event_type` is validated per-channel — the schema
has a conditional (`allOf`/`if`/`then`) branch for every event type constraining its `payload` shape, so a detector
cannot emit a `PERSON_COUNT` event on the `presence` channel or with a payload missing `n_persons`, for example.

**Explicit states, not implicit ones.** Every channel has a matching `<CHANNEL>_UNKNOWN` event type
(`PRESENCE_UNKNOWN`, `IDENTITY_UNKNOWN`, …) with a `reason` enum (`no_frames`, `low_light`, `occluded`,
`device_unavailable`, `connection_lost`, `detector_error`, `permission_denied`, `not_observable`). A detector that
cannot produce a real observation must emit the `_UNKNOWN` event for its channel, never silently omit the event or
emit a low-confidence guess — event absence and event unavailability are different things and both must be
representable. This is what `extract/pipeline.py`'s degraded-mode handling emits on a detector crash (see
`docs/ARCHITECTURE.md`).

There is deliberately no `DETECTED`/`NOT_DETECTED`/`ERROR` enum field on `event.v1` itself — those SRS-level states
are expressed as: a normal event = `DETECTED` (or a negative observation like `face_count: 0`, which is
`NOT_DETECTED`, still a real observation); a `_UNKNOWN` event type = `UNKNOWN`; and a detector exception surfaced
through the degraded-mode path = `ERROR` (recorded as `reason: detector_error` on the resulting `_UNKNOWN` event,
plus in `extract_recording`'s `meta["degraded"]`).

## `telemetry.v1` — `contracts/telemetry.v1.schema.json`

Browser/client heartbeat and capture-state telemetry (Tier 0), distinct from `event.v1` because it describes the
*client's own health* rather than a detector's observation of the candidate. Required: `schema`, `session_id`,
`ts_ms`, `seq` (monotonic, so gaps/reordering/drops are detectable), `capture_state`, `camera_state`,
`microphone_state`. Optional: `sampling_state` (adaptive sampling mode/fps), `heartbeat` (periodic keep-alive with
no state change), `client_metrics` (dropped frames, CPU estimate, network RTT), `virtual_camera_detected`
(nullable — `null` means `UNKNOWN`, never defaults to `false`), and an `integrity` object as an abstraction point
for a future telemetry-signing scheme.

**Status: schema defined and validated; not yet wired into a live browser client in this environment** (there was
no camera/browser harness available to exercise it end-to-end here — see `FINAL_STATUS.md`).

## `session_result.v1` — `contracts/session_result.v1.schema.json`

The risk engine's output (see `docs/RISK_ENGINE.md`). Required fields include `risk_level` (`NORMAL`/`WATCH`/
`ELEVATED`/`HIGH` — no `VIOLATION`), `recommendation`, `flags` (each with `rule_id`, `channel`, time window,
`resulting_level`, `explanation`, `evidence_ref`), `channels_available`/`channels_missing`,
`suppressed_missing_channel_flags` (the FR-33 audit trail), `degraded`, and `engine: "rule_based"`.
`overall_risk`/`confidence_band` are retained as a 0..1 display value for backward-compatible charts —
`calibrated` is always `false`, signalling that this is not a probability.

The legacy `risk_assessment.v1` schema/name is still accepted by `proctorstream.contracts.risk_assessment_errors` for
one transition period (the database column storing this JSON did not need a migration — see `docs/ARCHITECTURE.md`)
but new code should read/write `session_result.v1`.

## Validation

`proctorstream.contracts.event_errors(event)` and `risk_assessment_errors(result)` are hand-rolled validators (no
`jsonschema` dependency required at runtime) that enforce the same rules as the JSON Schema files, so they run
in any environment including this development sandbox, which has no network access to install `jsonschema`. The
JSON Schema files are the interoperable, tool-checkable spec for external consumers/generators.
