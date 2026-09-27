"""Deterministic, configuration-driven risk engine (replaces the learned risk-fusion model).

SRS requirement: the risk layer must be rule-based, transparent and testable, with **no** learned
scorer (CON-8). This module never trains, calibrates, or loads model weights. It is a pure function:

    flags (from proctorstream.features.engine.generate_flags, itself threshold-based, not learned)
    + channels_available / channels_missing
    + configs/risk.yaml
    -> session_result.v1

Every risk decision an engine instance makes is reproducible from (flags, config) alone, and every
session result lists exactly which rule(s) fired, on which evidence, over what time window - the
explainability the SRS risk engine section requires.

Missing evidence is *never* treated as suspicious (FR-30/FR-33): a rule can only fire for a channel
that is present in ``channels_available``; if its channel is missing the flag is recorded as
suppressed and contributes nothing to risk_level, by construction (there is no numeric score for
"missing" to leak into, unlike a learned model that has to be explicitly masked).
"""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from proctorstream.contracts import CHANNELS, RISK_LEVELS, SESSION_RESULT_SCHEMA
from proctorstream.features.engine import FEATURE_VERSION

from .config import RiskConfig, load_risk_config

ENGINE_NAME = "proctorstream-rule-engine"
ENGINE_VERSION = "1.0.0"

# Representative point + band per risk level, used only to populate the legacy 0..1
# `overall_risk` / `confidence_band` fields that the existing database schema and dashboard
# already expect. This is NOT a probability and NOT calibrated (`calibrated` is always False) -
# it exists purely so old storage/UI code that sorts or colours by a 0..1 number keeps working
# without a database migration. The authoritative output is `risk_level`.
_LEVEL_POINT = {"NORMAL": 0.05, "WATCH": 0.35, "ELEVATED": 0.65, "HIGH": 0.92}
_LEVEL_BAND = {
    "NORMAL": (0.0, 0.15),
    "WATCH": (0.15, 0.5),
    "ELEVATED": (0.5, 0.8),
    "HIGH": (0.8, 1.0),
}


def channels_from_features(feats: dict[str, float], threshold: float = 0.95) -> tuple[list[str], list[str]]:
    """Unchanged from proctorstream.modeling.model: a channel counts as missing for the session when
    its 'unknown fraction' feature is at/above threshold. Kept here too so risk_engine has no
    import-time dependency on the modeling/ package."""
    missing = [c for c in CHANNELS if feats.get(f"unk_{c}", 1.0) >= threshold]
    return [c for c in CHANNELS if c not in missing], missing


def _config_hash(cfg: RiskConfig) -> str:
    return hashlib.sha256(json.dumps(cfg.raw, sort_keys=True, default=str).encode()).hexdigest()


class RuleEngine:
    """Loads once, evaluated many times. Stateless across calls - `assess` takes everything it
    needs as arguments, so concurrent sessions never share mutable state."""

    def __init__(self, config: RiskConfig | None = None):
        self.config = config or load_risk_config()
        self.rules_by_type = self.config.rules_by_flag_type()
        self._hash = _config_hash(self.config)
        self.meta = {
            "model_version": f"rule-engine-v{ENGINE_VERSION}+{self._hash[:8]}",
            "rules_version": self._hash[:12],
            "rules_source": str(self.config.source_path),
        }

    @classmethod
    def load(cls, path: Path | str | None = None) -> "RuleEngine":
        return cls(load_risk_config(path))

    # -- per-flag evaluation --------------------------------------------------------------------
    def _flag_level(self, rule, duration_s: float, count_in_session: int) -> str:
        level = rule.base_level
        for esc in rule.escalate:
            hit = (esc.if_duration_s_gte is not None and duration_s >= esc.if_duration_s_gte) or (
                esc.if_count_in_session_gte is not None and count_in_session >= esc.if_count_in_session_gte
            )
            if hit and RISK_LEVELS.index(esc.then_level) > RISK_LEVELS.index(level):
                level = esc.then_level
        return level

    # -- session-level evaluation ----------------------------------------------------------------
    def assess(
        self,
        session_id: str,
        feats: dict[str, float] | None,
        flags: list[dict[str, Any]],
        channels_available: list[str],
        channels_missing: list[str],
    ) -> dict[str, Any]:
        missing_set = set(channels_missing)

        by_type: dict[str, list[dict[str, Any]]] = {}
        for fl in flags:
            by_type.setdefault(fl["type"], []).append(fl)

        evaluated: list[dict[str, Any]] = []
        suppressed: list[dict[str, Any]] = []
        unmapped: list[str] = []
        triggered_rule_ids: set[str] = set()
        session_level = "NORMAL"

        for ftype, instances in by_type.items():
            rule = self.rules_by_type.get(ftype)
            if rule is None:
                unmapped.append(ftype)
                continue
            if rule.channel in missing_set:
                for fl in instances:
                    suppressed.append(
                        {
                            "flag_id": fl["flag_id"],
                            "type": ftype,
                            "channel": rule.channel,
                            "reason": "channel_missing_never_increases_risk",
                        }
                    )
                continue
            count_in_session = len(instances)
            for fl in instances:
                duration_s = max(0.0, (fl["t_end_ms"] - fl["t_start_ms"]) / 1000.0)
                level = self._flag_level(rule, duration_s, count_in_session)
                if RISK_LEVELS.index(level) > RISK_LEVELS.index(session_level):
                    session_level = level
                triggered_rule_ids.add(rule.rule_id)
                evaluated.append(
                    {
                        "flag_id": fl["flag_id"],
                        "type": ftype,
                        "rule_id": rule.rule_id,
                        "channel": rule.channel,
                        "t_start_ms": fl["t_start_ms"],
                        "t_end_ms": fl["t_end_ms"],
                        "duration_s": round(duration_s, 1),
                        "confidence": fl["confidence"],
                        "resulting_level": level,
                        "explanation": f"{fl['explanation']} ({rule.description.strip()})".strip(),
                        "evidence_ref": fl.get("evidence_ref"),
                        "triggering_events": [fl["flag_id"]],
                    }
                )

        # Multi-flag escalation: several independent concern types in one session, even if no
        # single one reached a high level on its own.
        distinct_types = len(triggered_rule_ids)
        escalation_notes: list[str] = []
        for mfe in self.config.multi_flag_escalation:
            if distinct_types >= mfe.if_distinct_rule_types_gte:
                if RISK_LEVELS.index(mfe.min_level) > RISK_LEVELS.index(session_level):
                    session_level = mfe.min_level
                    escalation_notes.append(mfe.description)

        recommendation = self.config.recommendations[session_level]
        # Mirrors the previous model's convention: a session needing no action carries no
        # evidence flags for the reviewer to chase (flags exist to point at something to check).
        out_flags = [] if recommendation == "NO_ACTION" else sorted(
            evaluated, key=lambda e: (-RISK_LEVELS.index(e["resulting_level"]), e["t_start_ms"])
        )

        degraded = len(missing_set & set(self.config.degraded_mode.critical_channels)) >= (
            self.config.degraded_mode.min_missing_for_degraded
        )

        lo, hi = _LEVEL_BAND[session_level]
        top_contributors = [
            {
                "rule_id": e["rule_id"],
                "flag_type": e["type"],
                "level": e["resulting_level"],
                "explanation": e["explanation"],
            }
            for e in out_flags[:5]
        ]

        ra: dict[str, Any] = {
            "schema": SESSION_RESULT_SCHEMA,
            "session_id": session_id,
            "risk_level": session_level,
            "recommendation": recommendation,
            "overall_risk": round(_LEVEL_POINT[session_level], 4),
            "calibrated": False,
            "confidence_band": [round(lo, 4), round(hi, 4)],
            "flags": out_flags,
            "top_contributors": top_contributors,
            "channels_available": channels_available,
            "channels_missing": channels_missing,
            "suppressed_missing_channel_flags": suppressed,
            "unmapped_flag_types": unmapped,
            "multi_flag_escalation_applied": escalation_notes,
            "degraded": degraded,
            "engine": "rule_based",
            "model_version": self.meta["model_version"],
            "rules_version": self.meta["rules_version"],
            "feature_version": FEATURE_VERSION,
        }
        return ra


@lru_cache
def load_engine(path: str | None = None) -> RuleEngine:
    return RuleEngine.load(path)


__all__ = ["ENGINE_NAME", "ENGINE_VERSION", "RuleEngine", "channels_from_features", "load_engine"]
