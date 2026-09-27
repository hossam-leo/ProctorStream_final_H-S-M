from __future__ import annotations

import pytest

from proctorstream.contracts import LEVEL_TO_RECOMMENDATION, RECOMMENDATIONS, RISK_LEVELS, risk_assessment_errors
from proctorstream.risk_engine.config import RiskConfigError, load_risk_config
from proctorstream.risk_engine.engine import RuleEngine


def _flag(ftype: str, start_s: float, end_s: float, confidence: float = 0.8, flag_id: str = "flg_001") -> dict:
    return {
        "flag_id": flag_id,
        "type": ftype,
        "t_start_ms": int(start_s * 1000),
        "t_end_ms": int(end_s * 1000),
        "confidence": confidence,
        "explanation": f"{ftype} observed",
        "evidence_ref": "sessions/test#t=0,10",
    }


@pytest.fixture(scope="module")
def engine() -> RuleEngine:
    return RuleEngine.load()


# ---------------------------------------------------------------------------- config validation
def test_config_loads_and_matches_contract_levels(engine: RuleEngine) -> None:
    assert engine.config.risk_levels == RISK_LEVELS
    assert set(engine.config.recommendations.values()) <= set(RECOMMENDATIONS)
    assert engine.config.recommendations == LEVEL_TO_RECOMMENDATION


def test_no_violation_level_permitted() -> None:
    assert "VIOLATION" not in RISK_LEVELS
    with pytest.raises(RiskConfigError):
        # A config with an extra/renamed level must fail to load, not silently accept it.
        import textwrap

        import yaml

        from proctorstream.risk_engine.config import load_risk_config as _load

        bad = textwrap.dedent(
            """
            risk_levels: [NORMAL, WATCH, ELEVATED, VIOLATION]
            recommendations: {NORMAL: NO_ACTION, WATCH: ROUTINE_REVIEW, ELEVATED: HUMAN_REVIEW, VIOLATION: PRIORITY_REVIEW}
            rules: []
            session_aggregation: {multi_flag_escalation: []}
            degraded_mode: {critical_channels: [presence], min_missing_for_degraded: 2}
            """
        )
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "bad.yaml"
            p.write_text(bad)
            _load(p)
        assert yaml  # silence unused-import lint in this inline test


def test_every_flag_type_generated_by_feature_engine_has_a_rule(engine: RuleEngine) -> None:
    from proctorstream.features.engine import FLAG_RULES

    missing = set(FLAG_RULES) - set(engine.rules_by_type)
    assert not missing, f"flag types with no configured risk rule: {missing}"


# ---------------------------------------------------------------------------- baseline behaviour
def test_no_flags_is_normal_no_action(engine: RuleEngine) -> None:
    ra = engine.assess("s1", {}, [], [], [])
    assert ra["risk_level"] == "NORMAL"
    assert ra["recommendation"] == "NO_ACTION"
    assert ra["flags"] == []
    assert ra["calibrated"] is False


def test_output_passes_schema_validation(engine: RuleEngine) -> None:
    ra = engine.assess("s1", {}, [_flag("PHONE_USE", 0, 5)], ["environment"], [])
    errs = risk_assessment_errors(ra)
    assert errs == [], errs


# ---------------------------------------------------------------------------- rule triggering
def test_short_phone_use_is_elevated(engine: RuleEngine) -> None:
    ra = engine.assess("s2", {}, [_flag("PHONE_USE", 0, 10)], ["environment"], [])
    assert ra["risk_level"] == "ELEVATED"
    assert ra["recommendation"] == "HUMAN_REVIEW"
    assert ra["flags"][0]["rule_id"] == "RULE-PHONE-01"


def test_sustained_phone_use_escalates_to_high(engine: RuleEngine) -> None:
    ra = engine.assess("s3", {}, [_flag("PHONE_USE", 0, 45)], ["environment"], [])
    assert ra["risk_level"] == "HIGH"
    assert ra["recommendation"] == "PRIORITY_REVIEW"


def test_impersonation_is_always_high(engine: RuleEngine) -> None:
    ra = engine.assess("s4", {}, [_flag("IMPERSONATION", 0, 6)], ["identity"], [])
    assert ra["risk_level"] == "HIGH"


def test_repeated_tab_switch_escalates_by_count(engine: RuleEngine) -> None:
    flags = [_flag("TAB_SWITCH", i * 20, i * 20 + 3, flag_id=f"flg_{i:03d}") for i in range(4)]
    ra = engine.assess("s5", {}, flags, ["screen"], [])
    # 4 occurrences >= the 3-occurrence escalation threshold -> ELEVATED, below the 6-occurrence HIGH threshold
    assert ra["risk_level"] == "ELEVATED"


# ---------------------------------------------------------------------------- FR-33: missing evidence
def test_missing_channel_never_increases_risk(engine: RuleEngine) -> None:
    # The same flag that produces HIGH when its channel is available must never contribute to risk
    # when the channel is missing - it must be suppressed, not silently dropped.
    ra_available = engine.assess("s6a", {}, [_flag("IMPERSONATION", 0, 6)], ["identity"], [])
    ra_missing = engine.assess("s6b", {}, [_flag("IMPERSONATION", 0, 6)], [], ["identity"])
    assert ra_available["risk_level"] == "HIGH"
    assert ra_missing["risk_level"] == "NORMAL"
    assert ra_missing["recommendation"] == "NO_ACTION"
    assert len(ra_missing["suppressed_missing_channel_flags"]) == 1
    assert ra_missing["suppressed_missing_channel_flags"][0]["type"] == "IMPERSONATION"


def test_missing_channels_never_appear_as_evidence_in_any_output_list(engine: RuleEngine) -> None:
    flags = [_flag("PHONE_USE", 0, 40), _flag("IMPERSONATION", 0, 6, flag_id="flg_002")]
    ra = engine.assess("s7", {}, flags, ["environment"], ["identity"])
    # phone use (available channel) still drives risk to HIGH...
    assert ra["risk_level"] == "HIGH"
    # ...but the impersonation flag (missing channel) must not be counted as a contributor/flag.
    assert all(f["type"] != "IMPERSONATION" for f in ra["flags"])
    assert all(c["flag_type"] != "IMPERSONATION" for c in ra["top_contributors"])


# ---------------------------------------------------------------------------- multi-signal escalation
def test_three_independent_low_severity_concerns_escalate(engine: RuleEngine) -> None:
    flags = [
        _flag("TAB_SWITCH", 0, 2, flag_id="a"),
        _flag("SUSTAINED_GAZE_AWAY", 30, 35, flag_id="b"),
        _flag("CANDIDATE_ABSENT", 60, 65, flag_id="c"),
    ]
    ra = engine.assess("s8", {}, flags, ["screen", "attention", "presence"], [])
    # Each alone is WATCH; 3 distinct concern types must escalate to at least ELEVATED.
    assert RISK_LEVELS.index(ra["risk_level"]) >= RISK_LEVELS.index("ELEVATED")
    assert ra["multi_flag_escalation_applied"]


# ---------------------------------------------------------------------------- degraded mode
def test_degraded_flag_set_when_critical_channels_missing(engine: RuleEngine) -> None:
    ra = engine.assess("s9", {}, [], [], ["presence", "identity"])
    assert ra["degraded"] is True


def test_not_degraded_when_only_one_critical_channel_missing(engine: RuleEngine) -> None:
    ra = engine.assess("s10", {}, [], ["identity", "environment"], ["presence"])
    assert ra["degraded"] is False


# ---------------------------------------------------------------------------- determinism / reproducibility
def test_engine_is_deterministic(engine: RuleEngine) -> None:
    flags = [_flag("PHONE_USE", 0, 10), _flag("NOTE_READING", 20, 55, flag_id="b")]
    ra1 = engine.assess("s11", {}, flags, ["environment", "pose"], [])
    ra2 = engine.assess("s11", {}, flags, ["environment", "pose"], [])
    assert ra1 == ra2
