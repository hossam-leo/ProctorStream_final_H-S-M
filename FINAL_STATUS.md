# FINAL_STATUS

## Product

**ProctorStream — End-to-end AI proctoring inference platform**, built on the existing (authorized) ProctorStream
codebase. See `README.md` for the full picture and `docs/ARCHITECTURE.md` for the system design.

## What changed, and why

The core architectural requirement driving this work: the SRS (CON-8) requires session risk to be decided by a
**deterministic, rule-based engine with no learned scorer**. The prior codebase's risk decision was a learned
LightGBM/ROCKET model. That model is retained (`src/proctorstream/modeling/`, `models/trained/`) for historical
comparison but is no longer on the live scoring path anywhere — API, CLI batch scoring, and the dashboard all now
go through `src/proctorstream/risk_engine/`, a new deterministic rule engine reading `configs/risk.yaml`.

Everything downstream of that swap that referenced the old model's shape had to be found and fixed, not just the
one call site — see "Bugs found and fixed via audit" below.

## Implemented and verified in this environment

- **Rule-based risk engine** (`src/proctorstream/risk_engine/`): NORMAL/WATCH/ELEVATED/HIGH risk levels,
  NO_ACTION/ROUTINE_REVIEW/HUMAN_REVIEW/PRIORITY_REVIEW recommendations, no VIOLATION level, fully
  configuration-driven (`configs/risk.yaml`), explainable (every flag carries its rule ID, evidence, time window
  and resulting level). See `docs/RISK_ENGINE.md`.
- **Missing-evidence-never-raises-risk guarantee**: structurally enforced (a rule only evaluates for an available
  channel) and unit-tested with the *same* evidence producing HIGH when available and NORMAL when the channel is
  missing.
- **Versioned event contracts**: `event.v1` (pre-existing, reused), new `telemetry.v1` and `session_result.v1`
  JSON Schemas (`contracts/`), generated from `proctorstream.contracts` and regenerable with `proctorstream schemas`.
- **Degraded-mode handling**: found and fixed a real gap — `extract/pipeline.py` had no exception handling at all,
  so any single detector/frame failure would abort the whole session. Now video/audio extraction are isolated from
  each other, and per-frame failures degrade to explicit `*_UNKNOWN` events with the failure recorded in
  `meta["degraded"]`, rather than aborting.
- **Reviewer UI redesign**: new design tokens/palette/branding (`frontend/src/styles.css`, `App.tsx`, favicon,
  `index.html`), `AssessmentPanel`/`ReviewQueuePage` rewritten to show `risk_level`/`degraded` instead of a
  calibrated-probability score, and the "Model" page rewritten into a "Risk engine" page showing the live rules
  from `configs/risk.yaml` (via a new `/model-info` response shape) instead of ML calibration/PR-AUC charts.
- **Demo mode** (`scripts/demo_session.py`, `make demo`): generates a clearly-labelled simulated session and runs
  it through the *real* event validation → feature/flag extraction → risk engine → HTML report pipeline, with no
  camera, microphone, GPU, database, or external service. Run and verified for all three built-in scenarios
  (`clean`, `phone`, `multi`) — each produces the expected risk level and rule(s).
- **Observability**: `/health` (fixed — previously referenced the removed model bundle path and would have always
  reported the risk engine as unavailable), new `/ready` and `/metrics` endpoints.
- **HTML report** rewritten to explain rule-based decisions (rule ID, level, evidence) instead of SHAP
  contributions, and rebranded.
- **Documentation**: `README.md`, `SETUP_WINDOWS.md`, `docs/ARCHITECTURE.md`, `docs/RISK_ENGINE.md`,
  `docs/EVENT_CONTRACTS.md`, `docs/MODELS.md`, `docs/DEPLOYMENT.md`, `docs/BENCHMARKS.md`, `docs/PRIVACY.md`,
  `docs/LICENSE_AUDIT.md`, `docs/API.md` — all written to describe the current system, not a transformation
  narrative.

## Bugs found and fixed via audit (not present before this work)

1. `extract/pipeline.py` had no exception handling anywhere — a single bad frame or detector crash would abort an
   entire session. Fixed (see above).
2. Swapping the risk model broke `GET /model-info` and `GET /model/evaluation` (assumed the old model's
   `.meta["trained_at"]`, `.features`, etc.) and `GET /health`'s model-status field (checked a bundle path that no
   longer existed and would always evaluate false). Fixed — rewritten to reflect the rule engine and the retained
   legacy model respectively.
3. The CLI's `score-dir` (live batch scoring) defaulted to the old model directory path. Fixed — defaults to
   `configs/risk.yaml`; `train`/`evaluate`/`holdout` (legacy-model-only commands) were left pointing at the legacy
   model path and relabelled as reference-only.
4. **Found in this pass**: `OverviewPage.tsx` (the dashboard) read `/model-info`'s response as if it still had the
   old shape (`model.data.headline_metrics_validation.pr_auc`) — this field no longer exists on the new
   rule-engine `/model-info` response, so the dashboard would have thrown a runtime error rendering the "Risk
   model" stat card. Fixed — now reads `model_version`/`rules_version`/`rules.length` from the actual response
   shape.
5. **Found in this pass**: the sessions list (`GET /sessions`, `SessionsPage.tsx`) only exposed the legacy numeric
   `risk` field, not `risk_level`/`degraded`. Fixed — the list query now also selects `Prediction.assessment` and
   surfaces `risk_level`/`degraded` alongside the legacy numeric value, consistent with the review queue.
6. Corrected an inaccurate figure in `docs/MODELS.md` (the legacy model's PR-AUC was described as "~0.84" from
   memory; checked against the actual retained `training_results.json` and corrected to the real value, 0.883).

## What was deliberately kept, and why

- `src/proctorstream/modeling/` (LightGBM/ROCKET) and `models/trained/fusion-v1.0.0/` — traced their usages before
  deciding: they are actively read by `GET /model/evaluation`, the `ModelPage.tsx` "Legacy learned model" panel,
  `FairnessPage.tsx`'s fairness/robustness/drift analysis (all genuinely functional, verified against the real
  retained JSON artifacts in this pass — see below), and the CLI's `train`/`evaluate`/`holdout` commands. None of
  this is on the live risk-scoring path (verified: `serving.py`, `POST /score`, and `proctorstream score-dir` only
  import `proctorstream.risk_engine`), so it was kept as working reference/comparison tooling rather than deleted.
- Internal Python package names (`proctorstream`, `proctorstream_api`) — a full rename was considered again this round
  and again deliberately not done. The blast radius (pyproject.toml package discovery, ~40+ import sites, the CLI
  entry point, Alembic env.py, editable-install behaviour) cannot be fully verified without a working `pip install
  -e .` / `pytest` environment, which this sandbox does not have (see below). Renaming without being able to
  verify "the application must not break" would risk exactly the outcome that requirement rules out. All
  user-facing surfaces (UI, API title/docs, CLI `--help` text, reports, documentation) already say
  "ProctorStream" — see `docs/ARCHITECTURE.md`'s compatibility notes.


## Tests — actual results

`tests/unit/test_risk_engine.py`: **15/15 passing**, run via a local harness in this sandbox (real `pytest` could
not be installed — see "Environment limitations" below; the test file itself is ordinary pytest-style and will run
under real pytest unchanged). Covers config validation, rule triggering, duration/count-based escalation, the
missing-channel guarantee (two variants), multi-signal escalation, degraded-mode flagging, and determinism.

End-to-end verification beyond unit tests: `scripts/demo_session.py` run for all three scenarios (correct risk
level/rules each time); `proctorstream score-dir` run via the CLI against a generated session (correctly loaded the
rule engine from `configs/risk.yaml` and produced a valid `session_result.v1` + HTML report); `python -m py_compile`
run across every Python file touched or added (`src/`, `backend/`, `scripts/`, `tests/`) — all compile cleanly.

Pre-existing test suites (`tests/unit/test_contracts.py`, `test_features_models.py`, `tests/integration/`) were
**not run** — they require `pytest`, `jsonschema`, `fastapi`, `sqlalchemy`, `pydantic`, and/or a PostgreSQL
instance, none of which are available in this sandbox (see below). They were not modified in ways expected to
break them (the contracts/features changes are additive), but this is not the same as having run them.

## Benchmarks — actual results

Only the risk engine's own evaluation latency was measurable here (no GPU, no camera/microphone hardware, no
load-testing infrastructure): **p50 0.012ms, p95 0.020ms, p99 0.036ms** (n=2000, CPU, single-threaded —
`scripts/benchmark_risk_engine.py`, reproducible). GPU concurrency, capture-to-event latency, and 60-minute-session
Tier 2 batch throughput are **NOT VERIFIED** — see `docs/BENCHMARKS.md` for exactly what each would require.

## Requirements — status by area

| Area | Status |
|---|---|
| Deterministic rule-based risk engine, no learned scorer, no VIOLATION level | **Implemented & tested** |
| Versioned event/telemetry/session-result contracts, explicit UNKNOWN states | **Implemented** (telemetry.v1 schema defined; not yet exercised by a live browser client — see limitations) |
| Degraded-mode / no-session-termination-on-component-failure | **Implemented** (video/audio isolation, per-frame isolation); DB/storage/event-bus failure paths were not separately hardened in this pass |
| Reviewer UI redesign | **Implemented** (branding, risk-engine page, assessment panel, review queue); **not build-verified** (no `npm`/network access here) |
| Demo mode | **Implemented & run successfully** |
| Fine-tuned detector training pipeline | **Implemented** (dataset structure, scripts, versioning); **training itself NOT VERIFIED / PENDING** a real ≥1,500-image annotated dataset |
| Benchmarks (latency, concurrency, batch RTF) | **Partially measured** (risk engine only); rest **NOT VERIFIED / PENDING hardware** |
| Observability (`/health`, `/ready`, `/metrics`) | **Implemented**; some metric fields (queue depth, inference/ingest latency) are `null`, explicitly marked pending real load |
| Privacy/consent/deletion | **Mostly implemented** (consent gating, adult-only DB constraint, deletion workflow); encryption-at-rest and biometric-template separation are **gaps**, documented in `docs/PRIVACY.md` |
| License audit | **Implemented** (`docs/LICENSE_AUDIT.md`); frontend dependency audit not runnable without network access |
| Docker / Windows setup | Docker Compose pre-existing and CPU-only by construction; **not build-verified** (no Docker daemon here). `SETUP_WINDOWS.md` newly written, not tested on actual Windows. |

## Environment limitations (this development sandbox specifically)

No network access, so the following could not be installed or run here, independent of anything about the code
itself: `pytest`, `jsonschema`, `fastapi`, `sqlalchemy`, `pydantic`, `lightgbm`, `npm install` (frontend
build/typecheck). Where this affected verification, it's called out above and in the relevant doc rather than
silently assumed to be fine. Everything reported as "run" or "tested" in this document was genuinely executed in
this sandbox; everything reported as NOT VERIFIED was not run, and no numbers were invented for it.

## Demo

```bash
python scripts/demo_session.py --scenario multi   # or: clean | phone
```
Outputs a `session_result.v1` JSON and an HTML report to `demo_output/`.

## Full stack

```bash
cp .env.example .env
make install && make db
make api     # terminal 1
make web     # terminal 2
```
See `README.md` and `SETUP_WINDOWS.md` for details and troubleshooting.

## Production readiness gaps (beyond what's listed above)

- Replace the non-commercial-research-licensed face detector/embedding weights before commercial deployment
  (`docs/LICENSE_AUDIT.md`).
- Add encryption-at-rest for recordings and separate the biometric-template store from general session media
  (`docs/PRIVACY.md`).
- Complete the fine-tuned detector's training on a real annotated dataset.
- Run the pending benchmarks on target GPU hardware at target scale.
- Add authentication (there is none currently; this is a research/local-use prototype).
