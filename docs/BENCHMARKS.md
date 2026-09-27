# Benchmarks

Only measured values are reported below. Where the SRS requires a measurement this environment cannot produce
(no GPU, no 20-way concurrent real-time session harness, no camera/microphone hardware), that is stated explicitly
as **NOT VERIFIED**, not estimated or guessed.

## Measured: risk-engine evaluation latency

`scripts/benchmark_risk_engine.py`, run in this environment (CPU, single-threaded, n=2000 synthetic sessions,
each with 4 flags across 3 channels — a representative, moderately busy session):

| Metric | Value |
|---|---|
| p50 | 0.0121 ms |
| p95 | 0.0198 ms |
| p99 | 0.036 ms |
| mean | 0.0133 ms |
| max | 0.0773 ms |

This measures `RuleEngine.assess()` only — the deterministic risk decision given already-extracted flags. It is
effectively free relative to any detector inference or media processing step; it will not be the bottleneck in the
end-to-end pipeline under any realistic load. Re-run with `python scripts/benchmark_risk_engine.py --n <N>` to
reproduce.

## NOT VERIFIED — requires unavailable hardware/infrastructure

| SRS target | Requires | Status |
|---|---|---|
| Inference p50/p95/p99 (detector models) | A GPU or representative CPU inference harness with real video frames | NOT VERIFIED |
| Capture-to-event p50/p95 <2s | A real browser capture client + running backend + network path | NOT VERIFIED |
| ≥20 concurrent Tier 1 sessions on one GPU | A GPU and a load-testing harness driving 20 simultaneous real-time sessions | NOT VERIFIED |
| 60-minute session Tier 2 batch processing <10 min on one GPU | A GPU and a genuine 60-minute recording | NOT VERIFIED |
| Resource usage (CPU/memory/bandwidth) under load | A running deployment under representative load | NOT VERIFIED |
| Cost model | Deployment target's actual infrastructure pricing | NOT VERIFIED (a configurable calculator is a reasonable follow-up; none is implemented here) |

## What exists but wasn't run here

- `proctorstream.cli score-dir` — the batch scoring path — **was** run end-to-end in this environment (see
  `FINAL_STATUS.md`) and completed correctly, but on a single demo session, not the 60-minute/20-concurrent-session
  scale the SRS benchmarks target.
- ONNX Runtime automatically selects a GPU execution provider when available (`docs/DEPLOYMENT.md`), so the same
  detector code that would be benchmarked on GPU also runs on CPU here — but slower, uncharacterized CPU-only
  single-frame timings were not collected in this pass because no representative video corpus was available to
  drive them realistically.

## Before relying on any of the pending numbers

Run the above on target hardware with the dataset/benchmark script described. Do not substitute numbers from a
similar system, a different model, or an estimate — this document exists specifically so that unmeasured claims
are never presented as measured ones.
