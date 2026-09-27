# Deployment

## CPU / GPU

ProctorStream starts and runs on CPU only — no GPU is required. Detector inference uses ONNX Runtime, which
automatically uses a GPU execution provider (e.g. CUDA) if one is available and installed, and otherwise falls back
to CPU without any code change. `docker-compose.yml` does not request GPU resources, so the default Docker stack is
CPU-only by construction.

The risk engine itself (`src/proctorstream/risk_engine/`) has no GPU dependency of any kind — it is pure Python over
already-extracted flags and a YAML config.

When a detector model is unavailable (not downloaded, or the optional heavy model is disabled), the corresponding
channel degrades to `UNKNOWN` events rather than blocking startup — see `docs/ARCHITECTURE.md`'s degraded-mode
section and `docs/EVENT_CONTRACTS.md`.

## Docker

```bash
docker compose up --build
```

brings up `db` (PostgreSQL 16), `backend` (FastAPI, `docker/backend.Dockerfile`), and `frontend`
(`docker/frontend.Dockerfile`, served via nginx — see `docker/nginx.conf`), with the dashboard on
`http://localhost:8080`. Configuration comes from environment variables (`POSTGRES_*`, `PROCTORSTREAM_*`; see
`.env.example`) with sane defaults for local development. **The Docker configuration was written and reviewed but
could not be built in this development sandbox — there is no Docker daemon available here.** Validate
`docker compose up --build` in an environment with Docker before relying on it.

## Local (non-Docker) development

See the Quick start in `README.md` and `SETUP_WINDOWS.md` for Windows-specific instructions. Requires Python
3.10+, Node 20+, PostgreSQL 14+, ffmpeg.

## Configuration

All configuration is environment-variable-driven (`PROCTORSTREAM_*` prefix retained from the original codebase — see
`docs/ARCHITECTURE.md`'s compatibility notes) with `.env.example` documenting every variable. No credentials are
committed; `.env` is git-ignored.

The risk engine's behaviour is separately configured via `configs/risk.yaml` (see `docs/RISK_ENGINE.md`), settable
via the `PROCTORSTREAM_RISK_CONFIG` environment variable to point at an alternate rules file without a code change.

## Scaling / concurrency (SRS targets)

The SRS targets ≥20 concurrent Tier 1 sessions on one GPU with p95 inference latency <100ms, and a 60-minute
session's Tier 2 batch processing completing in <10 minutes on one GPU. **These have not been measured in this
environment** (no GPU, and no infrastructure to run 20 concurrent real-time sessions) — see `docs/BENCHMARKS.md`
for exactly what benchmark tooling exists and what running it would require.
