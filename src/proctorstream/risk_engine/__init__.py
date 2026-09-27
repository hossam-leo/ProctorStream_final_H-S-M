"""ProctorStream's deterministic, configuration-driven risk engine.

Replaces the learned LightGBM/ROCKET risk-fusion model (still present, unused, under
``proctorstream.modeling`` for reference) as required by the SRS (CON-8: no learned risk scorer).
See ``configs/risk.yaml`` for the rules and ``docs/RISK_ENGINE.md`` for the design.
"""

from .config import RiskConfig, RiskConfigError, load_risk_config
from .engine import RuleEngine, channels_from_features, load_engine

__all__ = [
    "RiskConfig",
    "RiskConfigError",
    "RuleEngine",
    "channels_from_features",
    "load_engine",
    "load_risk_config",
]
