#!/usr/bin/env python3
"""Benchmark the risk engine's own per-session evaluation latency (p50/p95/p99).

This is the one part of the SRS benchmark suite (docs/BENCHMARKS.md) that is meaningfully
measurable in a plain CPU sandbox with no GPU, camera, or database: RuleEngine.assess() itself,
given already-extracted flags. It does NOT measure detector inference latency, capture-to-event
latency, concurrent-session throughput, or GPU batch throughput - those need real hardware/media
and are marked NOT VERIFIED in docs/BENCHMARKS.md, not guessed at here.

Usage: python scripts/benchmark_risk_engine.py [--n 2000]
"""

from __future__ import annotations

import argparse
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from proctorstream.risk_engine.engine import RuleEngine  # noqa: E402


def _synthetic_flags(session_index: int) -> list[dict]:
    # A representative, moderately busy session: a handful of flags across several channels,
    # exercising both simple and escalating rules - not a worst case, not a best case.
    base = session_index * 1000
    return [
        {"flag_id": f"f{base}0", "type": "PHONE_USE", "t_start_ms": 1000, "t_end_ms": 11000, "confidence": 0.8,
         "explanation": "phone visible", "evidence_ref": None},
        {"flag_id": f"f{base}1", "type": "TAB_SWITCH", "t_start_ms": 20000, "t_end_ms": 22000, "confidence": 1.0,
         "explanation": "tab hidden", "evidence_ref": None},
        {"flag_id": f"f{base}2", "type": "TAB_SWITCH", "t_start_ms": 40000, "t_end_ms": 42000, "confidence": 1.0,
         "explanation": "tab hidden", "evidence_ref": None},
        {"flag_id": f"f{base}3", "type": "SUSTAINED_GAZE_AWAY", "t_start_ms": 60000, "t_end_ms": 65000, "confidence": 0.6,
         "explanation": "gaze away", "evidence_ref": None},
    ]


def run(n: int) -> dict:
    engine = RuleEngine.load()
    latencies_ms: list[float] = []
    for i in range(n):
        flags = _synthetic_flags(i)
        t0 = time.perf_counter()
        engine.assess(f"bench_{i}", {}, flags, ["environment", "screen", "attention"], [])
        latencies_ms.append((time.perf_counter() - t0) * 1000)

    latencies_ms.sort()
    def pct(p: float) -> float:
        idx = min(len(latencies_ms) - 1, int(len(latencies_ms) * p))
        return latencies_ms[idx]

    return {
        "n": n,
        "p50_ms": round(pct(0.50), 4),
        "p95_ms": round(pct(0.95), 4),
        "p99_ms": round(pct(0.99), 4),
        "mean_ms": round(statistics.mean(latencies_ms), 4),
        "max_ms": round(max(latencies_ms), 4),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--n", type=int, default=2000)
    args = ap.parse_args()
    r = run(args.n)
    print("Risk engine evaluation latency (RuleEngine.assess only; CPU, single-threaded, this machine):")
    for k, v in r.items():
        print(f"  {k}: {v}")
    print(
        "\nNOT measured here (require GPU/hardware/media not present in this environment): "
        "detector inference latency, capture-to-event latency, concurrent Tier 1 session throughput, "
        "60-minute-session Tier 2 batch RTF. See docs/BENCHMARKS.md."
    )


if __name__ == "__main__":
    main()
