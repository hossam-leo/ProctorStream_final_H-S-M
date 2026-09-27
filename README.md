# ProctorStream

**End-to-end AI proctoring inference platform.** ProctorStream helps a human reviewer decide **which online exam
sessions deserve a closer look**. It turns signals from video, audio and browser activity into a transparent,
rule-based risk level and a review recommendation. It never produces a verdict (SRS CON-5, ETH-6).

- **Recording:** consented mock-session recording from the browser (Tier 0 capture).
- **Signal extraction:** pretrained detectors applied to the recording (Tier 1 real-time signals, Tier 2 batch
  signals), each emitting versioned `event.v1` events with explicit `DETECTED` / `NOT_DETECTED` / `UNKNOWN` /
  `ERROR` states — missing evidence is never treated as suspicious.
- **Risk engine:** a **deterministic, configuration-driven rule engine** (`configs/risk.yaml`) turns those events
  into a `session_result.v1` — risk level, recommendation, and the exact rule(s), evidence and time window behind
  it. There is **no learned/ML risk scorer** in this decision (SRS CON-8) — see [docs/RISK_ENGINE.md](docs/RISK_ENGINE.md).
- **Degraded mode:** a detector crash, timeout, or missing channel degrades that channel to `UNKNOWN`/`ERROR` and
  is recorded on the session — it never aborts the session and never raises risk on its own.
- **Serving:** a scoring API, reviewer HTML reports, a review queue with reviewer decisions, and a batch CLI.
- **Demo mode:** the full event → risk-engine → report pipeline runnable end-to-end with **no GPU, camera,
  microphone, database, or external service** — see below.
- **Dashboard:** a redesigned web dashboard covering sessions, live capture, review, reports and the risk engine's
  own rules.

## Demo mode

```bash
python scripts/demo_session.py --scenario multi   # or: clean | phone
```

Generates one clearly-labelled **simulated** session, then runs it through the real event validation, feature/flag
extraction, the real rule-based risk engine, and the real HTML report generator. Nothing about the risk decision is
faked — only the input evidence is synthetic, and every event and the report itself say so. Output goes to
`demo_output/`. `make demo` runs the same thing.

## Quick start

Requirements:
- Python 3.10+, Node 20+, PostgreSQL 14+ and ffmpeg.
- Chrome, Edge or Firefox for recording.
- About 3 GB of disk space. No GPU is required to start — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for CPU/GPU behaviour.

```bash
cp .env.example .env
make install          # Python + frontend dependencies
make db                # PostgreSQL role and databases
make demo               # optional: see the risk engine work with zero infrastructure
make pipeline          # detector models, simulated data, features, (reference) training, evaluation, scoring
make api               # terminal 1: http://127.0.0.1:8000   (OpenAPI: /docs)
make web               # terminal 2: http://localhost:5173
```

`make pipeline` fetches the pretrained **detector** models (Tier 1/2 signal extraction) and rebuilds the simulated
dataset, features, and the **retained-for-reference** learned model evaluation (see [docs/MODELS.md](docs/MODELS.md)
— that model is not used to compute session risk). The risk engine itself needs none of this: it loads
`configs/risk.yaml` directly, which is why `make demo` and `make api` work before `make pipeline` has run.

Docker: `docker compose up --build` gives the dashboard on http://localhost:8080. CPU mode is the default; see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Using it

1. **Record** (`docs/MOCK_PROTOCOL.md`): register an adult participant, record consent, create a session, check the
   equipment, take the enrolment photo, record, then upload.
2. **Analyse:** starts automatically when the recording is uploaded (or press *Analyse recording*). Detectors run
   across all channels — presence, identity, liveness, attention/gaze, environment (objects/people), pose,
   voice/speaker, audio events, plus the browser's screen/device telemetry — then the rule-based risk engine.
   You get a risk level (NORMAL/WATCH/ELEVATED/HIGH), a recommendation, the specific rules that fired with
   evidence and time windows, a signal timeline, and an HTML report.
3. **Review:** the *Review queue* orders sessions by risk level. Record a decision; decisions are stored apart from
   any training labels, and the overturn rate is tracked.
4. **Inspect the rules:** the *Risk engine* page in the dashboard (and `GET /model-info`) shows every configured
   rule, its channel, its escalation thresholds, and the degraded-mode policy — live, from `configs/risk.yaml`.

**API** (see [docs/API.md](docs/API.md)):
- `POST /score` — takes `event.v1` events, returns a `session_result.v1`.
- `GET /model-info` — the live risk engine's rules and configuration.
- `GET /model/evaluation` — the retained legacy model's historical metrics, for reference only.
- `GET /health`, `GET /ready`, `GET /metrics`.
- Batch scoring: `proctorstream score-dir <input-dir> <output-dir>` (files named `<session_id>.jsonl`), which writes
  `session_result.v1` assessments and HTML reports for every session in a directory.

## Tests

```bash
make test     # unit + integration tests (integration needs PostgreSQL)
make e2e      # browser test with Chromium's synthetic camera: consent -> record -> analyse -> review
make lint     # ruff, mypy, strict TypeScript
```

`tests/unit/test_risk_engine.py` covers the rule engine directly (rule triggering, escalation, the
missing-channel-never-raises-risk guarantee, determinism) and needs no database, GPU, or trained model.

## Layout

```
src/proctorstream/          contracts, simulator, extract (detectors), features, risk_engine, modeling (legacy,
                          reference-only), validation, serving, CLI
backend/                 FastAPI service (PostgreSQL, storage, background analysis)
frontend/                React + TypeScript dashboard
configs/risk.yaml         the live, deployed risk-engine rules
configs/                 simulator versions, mock scripts
models/trained/          legacy learned-model bundle (reference only; not used for live risk)
reports/evaluation/      legacy model evaluation, fairness, robustness, drift, holdout results
scripts/demo_session.py  DEMO MODE generator
runs/                    experiment log (legacy model)
data/splits/             split manifests + sealed-holdout access log (committed)
docs/                    architecture, API, event contracts, risk engine, models, deployment, benchmarks, privacy
```

## Current status and known limitations

- **The risk engine is real and tested end-to-end in this environment** (deterministic rules, unit-tested,
  exercised through the CLI batch scorer and the demo generator). See `FINAL_STATUS.md` for exactly what was run
  and what wasn't.
- The **fine-tuned Tier-2 detector training pipeline** (≥1,500 annotated images) is implemented (dataset structure,
  training/eval scripts, versioning) but **actual training is pending a real annotated dataset** — not fabricated.
- **GPU concurrency and 60-minute-session batch benchmarks** from the SRS targets are **not verified** in this
  environment (no GPU, no large-scale run performed). See `docs/BENCHMARKS.md`.
- Some detectors are heuristics (speaker ID, blink-based liveness, audio events, head-pose gaze). Body pose needs
  the elbows in view; with a head-and-shoulders webcam it is reported `UNKNOWN`, which never raises risk.
- The learned LightGBM/ROCKET model from earlier development is retained under `src/proctorstream/modeling/` and
  `models/trained/` for historical comparison only — it is not on the live scoring path.
- There is no authentication; this is for local/research use, not production deployment as-is.
