# API

FastAPI service (`backend/proctorstream_api/`). Interactive docs at `/docs` (Swagger UI) and `/openapi.json` once the
API is running (`make api`).

## Observability

- `GET /health` — liveness. Checks database, storage, and that the risk engine's config loads. Never blocks on
  application load; safe for a container liveness probe.
- `GET /ready` — readiness. Checks the same dependencies but returns `{"ready": false, "reasons": [...]}` with
  the specific reason(s) rather than a boolean-only status, so a readiness probe failure is diagnosable without
  needing to attach a debugger.
- `GET /metrics` — point-in-time counters (active sessions, total events, dropped/rejected events, detector
  `*_UNKNOWN` event count, degraded-session count). Plain JSON, not Prometheus text-exposition format. Fields that
  require infrastructure not present in this environment (queue depth, inference/ingest latency) are explicitly
  `null` rather than fabricated — see `docs/BENCHMARKS.md`.

## Risk engine

- `GET /model-info` — the live rule engine's version, rules, escalation config and degraded-mode policy, read
  directly from `configs/risk.yaml`. See `docs/RISK_ENGINE.md`.
- `GET /model/evaluation` — the retained legacy learned model's historical metrics, explicitly labelled
  reference-only (not used for live risk decisions).
- `POST /score` — score a session directly from `event.v1` events (bypassing the stored-session flow), returns a
  `session_result.v1`. Used by anything that wants to score events without going through the recording/upload
  pipeline (e.g. external integrations, testing).

## Sessions and analysis (`routers/sessions.py`, `routers/analysis.py`)

- `POST /participants`, session creation, consent, recording upload — the mock-session recording flow
  (`docs/MOCK_PROTOCOL.md`).
- Uploading a recording triggers analysis automatically (`queue_analysis`): detector extraction → feature/flag
  computation → risk engine → stored `session_result.v1` (`Prediction.assessment`) → HTML report available for
  download.
- `GET /sessions/{id}/report` — the HTML reviewer report, recomputed from stored events (so it always reflects the
  current risk-engine configuration, not a stale cached score).
- `GET /review-queue` — sessions ordered by risk level, with `risk_level`, `degraded`, recommendation and the top
  reason for review triage.
- `POST /sessions/{id}/review` — record a reviewer decision (verdict + note), stored separately from any
  training/simulation labels.
- `POST /sessions/{id}/delete` — deletion workflow (requires explicit confirmation + reason; audited).

## Batch scoring (CLI, not HTTP)

`proctorstream score-dir <input-dir> <output-dir>` scores a directory of `<session_id>.jsonl` event files with the
live rule engine and writes `session_result.v1` assessments and HTML reports for each. See `README.md`.

## Error handling

Invalid input returns `422` with the specific validation failure (FastAPI/Pydantic). Event/session-result schema
violations are reported explicitly (`proctorstream.contracts.event_errors`/`risk_assessment_errors`) rather than
silently coerced or dropped.
