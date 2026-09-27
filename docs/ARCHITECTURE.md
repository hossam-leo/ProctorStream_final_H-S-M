# Architecture

## Overview

```
Browser (Tier 0)                     Ingest                      Processing                    Output
─────────────────                    ──────                      ──────────                    ──────
camera / mic capture      ──event.v1──▶  media/segment storage
face detection (client)                  telemetry gateway            Tier 1 real-time detectors
virtual-camera check      ──telemetry.v1▶  (screen/device/            Tier 2 batch detectors
adaptive sampling                          capture-state)                     │
heartbeat                                                                     ▼
                                                                      feature/flag extraction
                                                                      (deterministic thresholds)
                                                                                │
                                                                                ▼
                                                                       RISK ENGINE (rule-based,
                                                                       configs/risk.yaml)
                                                                                │
                                                                                ▼
                                                                       session_result.v1
                                                                          /            \
                                                                         ▼              ▼
                                                                  Reviewer UI      HTML report
```

## Components

| Component | Where | Notes |
|---|---|---|
| Event/telemetry/session-result contracts | `src/proctorstream/contracts.py` | Versioned, schema-validated. See `docs/EVENT_CONTRACTS.md`. |
| Tier 1/2 detector extraction | `src/proctorstream/extract/` | Pretrained detectors (face, identity, liveness, gaze, objects, pose, voice). Degraded-mode-hardened (see below). |
| Deterministic flag generation | `src/proctorstream/features/engine.py` | Threshold-based, not learned. Produces time-bounded flags from the per-second signal grid. |
| **Risk engine** | `src/proctorstream/risk_engine/` | Deterministic, configuration-driven (`configs/risk.yaml`). See `docs/RISK_ENGINE.md`. This is the component that decides `risk_level`/`recommendation`; no learned model is in this path. |
| Legacy learned model | `src/proctorstream/modeling/`, `models/trained/` | Retained for historical/offline comparison only. Not called by `serving.py`, the API, or the CLI's live scoring path. See `docs/MODELS.md`. |
| Serving / batch scoring | `src/proctorstream/serving.py`, `proctorstream score-dir` CLI | One code path: validate → flat → features/flags → risk engine → `session_result.v1` + HTML report. |
| API | `backend/proctorstream_api/` | FastAPI. Sessions, consent, recording, analysis jobs, review queue, reviewer decisions, risk-engine introspection (`/model-info`). |
| Persistence | PostgreSQL (prod), SQLite-compatible patterns for local dev | Sessions, events, telemetry, predictions (`session_result.v1` JSON), reviewer actions, audit log. |
| Dashboard | `frontend/` (React + TypeScript) | Dashboard, session list/detail, live session, review queue, reports, risk-engine rules view, settings. |
| Demo mode | `scripts/demo_session.py` | Full pipeline (event validation → flags → risk engine → report) with synthetic, clearly-labelled evidence. No camera/mic/GPU/DB required. |

## Degraded-mode handling

Detector failures must not abort a session (SRS Section 12). This is enforced at two points in
`src/proctorstream/extract/pipeline.py`:

1. **Modality isolation** (`extract_recording`): video and audio extraction are each wrapped independently. If one
   raises, the other's results are still used; the failed modality's channels degrade to explicit `*_UNKNOWN`
   events with `reason: detector_error`, and the failure is recorded in `meta["degraded"]` for the audit trail —
   nothing is silently swallowed.
2. **Per-frame isolation** (`extract_video`'s inner loop): the per-frame detector body is wrapped so that one bad
   frame (a decode glitch, a transient model error) degrades that frame's channels to `UNKNOWN` and processing
   continues, rather than aborting the remaining minutes of a session over a single frame.

Both paths feed into the same `channels_available`/`channels_missing` computation the risk engine already treats
as never-risk-increasing (see `docs/RISK_ENGINE.md`), so a degraded detector and a genuinely absent signal are
handled by the same, already-tested mechanism.

## Compatibility notes

- The risk engine's output (`session_result.v1`) is a superset of the previous `risk_assessment.v1` shape used by
  the database and dashboard (`overall_risk`, `recommendation`, `confidence_band`, `flags`, `model_version` are all
  still present, now alongside `risk_level`, `degraded`, `rules_version`, etc.), so no database migration was
  needed to switch the scoring method.
- Internal Python package/module names (`proctorstream`, `proctorstream_api`) and infrastructure identifiers (database
  role/name, `PROCTORSTREAM_*` environment variable prefix) are retained rather than renamed. These are not
  user-facing — the product name, UI, API title/description, HTML reports, and documentation all say
  "ProctorStream" — and renaming them would touch import paths and deployment configuration across the codebase
  for no user-visible benefit, at real risk of breakage that could not be fully verified without a working
  Python/Node toolchain (see `FINAL_STATUS.md` for what could and couldn't be run in this environment).
