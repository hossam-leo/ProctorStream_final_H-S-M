#!/usr/bin/env python3
"""ProctorStream DEMO MODE (SRS Section 17 / master-task Section 14).

Generates ONE scripted, clearly-labelled DEMO session's event.v1 events (no camera, microphone,
GPU, or external AI service required) and runs it through the real pipeline:

    demo events (SIMULATED) -> event validation -> feature/flag extraction
        -> REAL deterministic rule-based risk engine (configs/risk.yaml)
        -> session_result.v1 -> HTML reviewer report

Nothing about the risk decision is faked: the same proctorstream.serving.score_frame() call used by
the API and the batch CLI is used here. Only the *evidence* (the events) is synthetic, and every
event and the generated report say so explicitly.

Usage:
    python scripts/demo_session.py [--out demo_output] [--scenario clean|phone|multi]

Requires only: numpy, pandas, pyyaml (already project dependencies; no GPU, DB, or network).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from proctorstream.contracts import event_errors  # noqa: E402
from proctorstream.serving import events_to_frame, render_report, score_frame  # noqa: E402

DEMO_SESSION_PREFIX = "demo_"


def _face(ts_ms: int, session_id: str, face_count: int = 1) -> dict:
    return {
        "schema": "event.v1",
        "session_id": session_id,
        "ts_ms": ts_ms,
        "channel": "presence",
        "detector": "face_detector",
        "detector_version": "demo-scripted-v1",
        "event_type": "FACE_OBSERVATION",
        "payload": {
            "face_count": face_count,
            "bbox_area_ratio": 0.14 if face_count else 0.0,
            "center_offset_x": 0.02,
            "center_offset_y": 0.0,
        },
        "confidence": 0.9,
        "quality": {"frame_blur": 0.1, "frame_luma": 120, "usable": True},
    }


def _identity(ts_ms: int, session_id: str, verified: bool = True) -> dict:
    return {
        "schema": "event.v1",
        "session_id": session_id,
        "ts_ms": ts_ms,
        "channel": "identity",
        "detector": "identity_verifier",
        "detector_version": "demo-scripted-v1",
        "event_type": "IDENTITY_CHECK",
        "payload": {"cosine_sim": 0.86 if verified else 0.21, "verified": verified, "face_quality": 0.8},
        "confidence": 0.85,
    }


def _liveness(ts_ms: int, session_id: str, passed: bool = True) -> dict:
    return {
        "schema": "event.v1",
        "session_id": session_id,
        "ts_ms": ts_ms,
        "channel": "liveness",
        "detector": "liveness_check",
        "detector_version": "demo-scripted-v1",
        "event_type": "LIVENESS_CHECK",
        "payload": {"pad_score": 0.95 if passed else 0.1, "pad_pass": passed},
        "confidence": 0.8,
    }


def _gaze(ts_ms: int, session_id: str, on_screen: bool = True) -> dict:
    return {
        "schema": "event.v1",
        "session_id": session_id,
        "ts_ms": ts_ms,
        "channel": "attention",
        "detector": "head_gaze",
        "detector_version": "demo-scripted-v1",
        "event_type": "HEAD_GAZE",
        "payload": {
            "yaw": 2.0 if on_screen else 42.0,
            "pitch": -3.0,
            "roll": 0.5,
            "gaze_on_screen_prob": 0.92 if on_screen else 0.08,
        },
        "confidence": 0.75,
    }


def _person_count(ts_ms: int, session_id: str, n: int = 1) -> dict:
    return {
        "schema": "event.v1",
        "session_id": session_id,
        "ts_ms": ts_ms,
        "channel": "environment",
        "detector": "object_detector",
        "detector_version": "demo-scripted-v1",
        "event_type": "PERSON_COUNT",
        "payload": {"n_persons": n},
        "confidence": 0.8,
    }


def _object(ts_ms: int, session_id: str, label: str) -> dict:
    return {
        "schema": "event.v1",
        "session_id": session_id,
        "ts_ms": ts_ms,
        "channel": "environment",
        "detector": "object_detector",
        "detector_version": "demo-scripted-v1",
        "event_type": "OBJECT_DETECTED",
        "payload": {"label": label, "bbox_x": 0.4, "bbox_y": 0.7, "bbox_w": 0.1, "bbox_h": 0.15},
        "confidence": 0.72,
    }


def _tab(ts_ms: int, session_id: str, hidden: bool) -> dict:
    return {
        "schema": "event.v1",
        "session_id": session_id,
        "ts_ms": ts_ms,
        "channel": "screen",
        "detector": "browser_telemetry",
        "detector_version": "demo-scripted-v1",
        "event_type": "TAB_VISIBILITY",
        "payload": {"hidden": hidden},
        "confidence": 1.0,
    }


def _voice(ts_ms: int, session_id: str, speaking: bool = True, foreign: bool = False) -> dict:
    return {
        "schema": "event.v1",
        "session_id": session_id,
        "ts_ms": ts_ms,
        "channel": "audio_voice",
        "detector": "voice_activity",
        "detector_version": "demo-scripted-v1",
        "event_type": "VOICE_ACTIVITY",
        "payload": {
            "vad_active": speaking,
            "speaker_is_candidate": not foreign,
            "n_speakers": 2 if foreign else 1,
            "foreign_speech": foreign,
        },
        "confidence": 0.7,
    }


SCENARIOS = {
    "clean": {"phone_window": None, "tab_switches": [], "foreign_voice_window": None},
    "phone": {"phone_window": (60, 100), "tab_switches": [], "foreign_voice_window": None},
    "multi": {
        "phone_window": (40, 70),
        "tab_switches": [20, 45, 90, 130, 150, 160],
        "foreign_voice_window": (110, 135),
    },
}


def generate_demo_session(session_id: str, duration_s: int = 180, scenario: str = "multi") -> list[dict]:
    """Deterministic (seeded), clearly-labelled synthetic event.v1 stream for one demo session."""
    cfg = SCENARIOS[scenario]
    events: list[dict] = []

    for t in range(0, duration_s):
        phone_on = cfg["phone_window"] and cfg["phone_window"][0] <= t < cfg["phone_window"][1]
        foreign_on = cfg["foreign_voice_window"] and cfg["foreign_voice_window"][0] <= t < cfg["foreign_voice_window"][1]

        events.append(_face(t * 1000, session_id))
        if t % 5 == 0:
            events.append(_identity(t * 1000, session_id, verified=True))
        if t % 10 == 0:
            events.append(_liveness(t * 1000, session_id, passed=True))
        if t % 2 == 0:
            events.append(_gaze(t * 1000, session_id, on_screen=True))
        if t % 2 == 0:
            events.append(_person_count(t * 1000, session_id, n=1))
        if phone_on and t % 2 == 0:
            events.append(_object(t * 1000, session_id, "cell_phone"))
        if t % 1 == 0:
            events.append(_voice(t * 1000, session_id, speaking=(t % 7 == 0), foreign=bool(foreign_on)))

    for sw in cfg["tab_switches"]:
        events.append(_tab(sw * 1000, session_id, hidden=True))
        events.append(_tab((sw + 2) * 1000, session_id, hidden=False))

    events.sort(key=lambda e: e["ts_ms"])
    return events


def run_demo(out_dir: Path, scenario: str, duration_s: int) -> dict:
    session_id = f"{DEMO_SESSION_PREFIX}{scenario}_{int(time.time())}"
    events = generate_demo_session(session_id, duration_s=duration_s, scenario=scenario)

    rejected = [{"index": i, "reason": "; ".join(errs)} for i, e in enumerate(events) if (errs := event_errors(e))]
    if rejected:
        raise RuntimeError(f"demo generator produced {len(rejected)} schema-invalid events: {rejected[:3]}")

    df, rejected2 = events_to_frame(events)
    ra, sf = score_frame(session_id, df, float(duration_s))
    ra["_meta"] = {
        "source": "Simulated (DEMO MODE)",
        "scenario": scenario,
        "events_generated": len(events),
        "events_accepted": len(df),
        "events_rejected": len(rejected2),
    }

    report_html = render_report(
        ra,
        float(duration_s),
        sf.grid,
        None,
        df,
        {"source": "Simulated (DEMO MODE)", "participant_code": f"DEMO-{scenario.upper()}"},
    )

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"{session_id}.session_result.json").write_text(json.dumps(ra, indent=2))
    (out_dir / f"{session_id}.report.html").write_text(report_html, encoding="utf-8")
    return ra


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=str(ROOT / "demo_output"))
    ap.add_argument("--scenario", choices=list(SCENARIOS), default="multi")
    ap.add_argument("--duration", type=int, default=180)
    args = ap.parse_args()

    ra = run_demo(Path(args.out), args.scenario, args.duration)
    print(f"DEMO MODE session: {ra['session_id']}")
    print(f"  scenario:        {args.scenario} (SIMULATED evidence, real rule-based risk engine)")
    print(f"  risk_level:      {ra['risk_level']}")
    print(f"  recommendation:  {ra['recommendation']}")
    print(f"  flags:           {len(ra['flags'])}")
    for f in ra["flags"]:
        print(f"    - [{f['resulting_level']:8s}] {f['rule_id']:18s} {f['explanation']}")
    print(f"  degraded:        {ra['degraded']}")
    print(f"  engine:          {ra['model_version']} (rules {ra['rules_version']})")
    print(f"\nWrote: {args.out}/{ra['session_id']}.session_result.json")
    print(f"Wrote: {args.out}/{ra['session_id']}.report.html")


if __name__ == "__main__":
    main()
