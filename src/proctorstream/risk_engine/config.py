"""Loads and validates ``configs/risk.yaml`` (SRS Section 9 / risk engine spec).

Kept deliberately separate from ``engine.py`` so the *evaluation* logic and the *configuration*
it reads can be tested independently, and so a deployment can swap in a different rules file via
``PROCTORSTREAM_RISK_CONFIG`` without touching code.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from proctorstream.contracts import CHANNELS, RISK_LEVELS

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CONFIG_PATH = ROOT / "configs" / "risk.yaml"


class RiskConfigError(ValueError):
    """Raised when configs/risk.yaml is missing, malformed, or internally inconsistent."""


@dataclass(frozen=True)
class Escalation:
    then_level: str
    if_duration_s_gte: float | None = None
    if_count_in_session_gte: int | None = None


@dataclass(frozen=True)
class Rule:
    rule_id: str
    flag_type: str
    channel: str
    base_level: str
    description: str = ""
    escalate: tuple[Escalation, ...] = ()


@dataclass(frozen=True)
class MultiFlagEscalation:
    if_distinct_rule_types_gte: int
    min_level: str
    description: str = ""


@dataclass(frozen=True)
class DegradedModeConfig:
    critical_channels: tuple[str, ...]
    min_missing_for_degraded: int


@dataclass(frozen=True)
class RiskConfig:
    risk_levels: tuple[str, ...]
    recommendations: dict[str, str]
    rules: tuple[Rule, ...]
    multi_flag_escalation: tuple[MultiFlagEscalation, ...]
    degraded_mode: DegradedModeConfig
    source_path: Path
    raw: dict[str, Any] = field(repr=False, default_factory=dict)

    def rules_by_flag_type(self) -> dict[str, Rule]:
        return {r.flag_type: r for r in self.rules}


def _require(d: dict[str, Any], key: str, path: str) -> Any:
    if key not in d:
        raise RiskConfigError(f"{path}: missing required key '{key}'")
    return d[key]


def load_risk_config(path: Path | str | None = None) -> RiskConfig:
    """Load and validate the risk-rule configuration. Raises RiskConfigError on any inconsistency
    (unknown channel, unknown level, duplicate rule_id, etc.) - a broken config must fail loudly at
    startup, never silently fall back to some default risk behaviour."""
    p = Path(path or os.environ.get("PROCTORSTREAM_RISK_CONFIG") or DEFAULT_CONFIG_PATH)
    if not p.exists():
        raise RiskConfigError(f"risk config not found: {p}")
    raw = yaml.safe_load(p.read_text()) or {}

    levels = tuple(_require(raw, "risk_levels", "risk_levels"))
    if levels != RISK_LEVELS:
        raise RiskConfigError(f"risk_levels must be exactly {list(RISK_LEVELS)}, got {list(levels)}")
    if "VIOLATION" in levels:
        raise RiskConfigError("VIOLATION is not a permitted risk level (SRS CON-5 / ETH-6)")

    recs_raw = _require(raw, "recommendations", "recommendations")
    recs = {k: v for k, v in recs_raw.items()}
    if set(recs) != set(levels):
        raise RiskConfigError("recommendations must define exactly one entry per risk level")

    rules: list[Rule] = []
    seen_ids: set[str] = set()
    seen_flag_types: set[str] = set()
    for i, r in enumerate(_require(raw, "rules", "rules")):
        path = f"rules[{i}]"
        rid = _require(r, "rule_id", path)
        if rid in seen_ids:
            raise RiskConfigError(f"{path}: duplicate rule_id '{rid}'")
        seen_ids.add(rid)
        flag_type = _require(r, "flag_type", path)
        if flag_type in seen_flag_types:
            raise RiskConfigError(f"{path}: duplicate flag_type '{flag_type}' (one rule per flag type)")
        seen_flag_types.add(flag_type)
        channel = _require(r, "channel", path)
        if channel not in CHANNELS:
            raise RiskConfigError(f"{path}: unknown channel '{channel}', must be one of {list(CHANNELS)}")
        base_level = _require(r, "base_level", path)
        if base_level not in levels:
            raise RiskConfigError(f"{path}: unknown base_level '{base_level}'")
        escs = []
        for j, e in enumerate(r.get("escalate") or []):
            then_level = _require(e, "then_level", f"{path}.escalate[{j}]")
            if then_level not in levels:
                raise RiskConfigError(f"{path}.escalate[{j}]: unknown then_level '{then_level}'")
            escs.append(
                Escalation(
                    then_level=then_level,
                    if_duration_s_gte=e.get("if_duration_s_gte"),
                    if_count_in_session_gte=e.get("if_count_in_session_gte"),
                )
            )
        rules.append(
            Rule(
                rule_id=rid,
                flag_type=flag_type,
                channel=channel,
                base_level=base_level,
                description=(r.get("description") or "").strip(),
                escalate=tuple(escs),
            )
        )

    agg = _require(raw, "session_aggregation", "session_aggregation")
    mfe = []
    for i, e in enumerate(agg.get("multi_flag_escalation") or []):
        path = f"session_aggregation.multi_flag_escalation[{i}]"
        min_level = _require(e, "min_level", path)
        if min_level not in levels:
            raise RiskConfigError(f"{path}: unknown min_level '{min_level}'")
        mfe.append(
            MultiFlagEscalation(
                if_distinct_rule_types_gte=_require(e, "if_distinct_rule_types_gte", path),
                min_level=min_level,
                description=(e.get("description") or "").strip(),
            )
        )

    dm = _require(raw, "degraded_mode", "degraded_mode")
    critical = tuple(_require(dm, "critical_channels", "degraded_mode.critical_channels"))
    for c in critical:
        if c not in CHANNELS:
            raise RiskConfigError(f"degraded_mode.critical_channels: unknown channel '{c}'")

    return RiskConfig(
        risk_levels=levels,
        recommendations=recs,
        rules=tuple(rules),
        multi_flag_escalation=tuple(mfe),
        degraded_mode=DegradedModeConfig(
            critical_channels=critical,
            min_missing_for_degraded=int(_require(dm, "min_missing_for_degraded", "degraded_mode")),
        ),
        source_path=p,
        raw=raw,
    )


__all__ = [
    "DegradedModeConfig",
    "Escalation",
    "MultiFlagEscalation",
    "Rule",
    "RiskConfig",
    "RiskConfigError",
    "load_risk_config",
]
