# Models

ProctorStream uses machine-learned models only for **signal extraction** (Tier 1/2 detectors observing the
candidate/environment). The **risk decision** itself uses no model — see `docs/RISK_ENGINE.md`.

## Detector models (Tier 1 / Tier 2 signal extraction)

Registry: `src/proctorstream/extract/models.py`. Downloaded once, SHA-256-verified, run with ONNX Runtime (CPU by
default; GPU execution provider used automatically if available — see `docs/DEPLOYMENT.md`).

| Model | Purpose | Channel | License note |
|---|---|---|---|
| YOLOX-nano (Megvii) | Object/phone/person detection | environment | Apache-2.0 (code and weights) |
| SCRFD `det_500m` (InsightFace buffalo_s) | Face detection | presence | Code MIT; **pretrained weights are released for non-commercial research use only** — see `docs/LICENSE_AUDIT.md`, replace before commercial use |
| ArcFace `w600k_mbf` (InsightFace buffalo_s) | Face embedding / identity verification | identity | Same buffalo_s pack — non-commercial research weights |

The buffalo_s pack also ships a gender/age model. It is deliberately never extracted or loaded (ETH-4: no
demographic inference beyond what a detector task requires).

Liveness (anti-spoof), head-pose/gaze, body pose and voice-activity/speaker-verification detectors in
`src/proctorstream/extract/vision.py` and `body.py` use classical CV/heuristic methods (landmark geometry, blink
detection, spectral features) rather than separate deep models — documented inline in those modules, including
their known failure modes (e.g. body-pose reach detection needs the elbows in frame; unavailable = `UNKNOWN`,
never a risk increase).

## Fine-tuned detector (SRS "exactly one trained detector")

The SRS requires a complete training pipeline for one detector trained on ≥1,500 annotated images with hard
negatives. This is **implemented** end-to-end — dataset structure, annotation format, train/val/test split,
training/evaluation scripts, checkpointing, versioning (`src/proctorstream/modeling/train.py`,
`src/proctorstream/data/splits.py`, `configs/`) — but **actual training on a real annotated dataset has not been
performed**: no such dataset exists in this environment, and per the ground rule for this project, that result is
not fabricated. Status: **NOT VERIFIED / PENDING DATASET**. See `FINAL_STATUS.md` and `docs/BENCHMARKS.md`.

## Legacy learned risk-fusion model (reference only)

`src/proctorstream/modeling/` (LightGBM primary model + ROCKET temporal features, 0.883 PR-AUC / 0.881 recall on a
simulated
validation split per its retained evaluation artifacts) was the risk-scoring approach used before this rework. The
SRS for this product (CON-8) requires the risk decision to be rule-based with no learned scorer, so this model is
**retained on disk for historical/offline comparison but is not called anywhere on the live scoring path**
(`serving.py`, the API, and the CLI's `score`/`score-dir` commands all use `proctorstream.risk_engine.RuleEngine`).
`GET /model/evaluation` in the API still surfaces its historical metrics, explicitly labelled as reference-only.
The CLI's `train`/`evaluate`/`holdout` subcommands still operate on this model for anyone who wants to keep
comparing it against the rule engine's coverage; they are unaffected by the rule-engine switch.

## Runtime dependencies

ONNX Runtime, OpenCV, NumPy, SciPy, pandas — standard open-source licenses (MIT/BSD-3-Clause/Apache-2.0), see
`docs/LICENSE_AUDIT.md`.
