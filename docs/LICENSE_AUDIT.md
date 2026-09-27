# License audit

Code licenses and model-weight licenses are audited separately below — they are not the same thing, and a
permissively-licensed library can still ship weights under a more restrictive license (this is the case for the
face detector/embedding models here).

## Python dependencies (`requirements.txt`)

| Package | License | Notes |
|---|---|---|
| numpy | BSD-3-Clause | |
| pandas | BSD-3-Clause | |
| pyarrow | Apache-2.0 | |
| scikit-learn | BSD-3-Clause | |
| PyYAML | MIT | |
| pydantic / pydantic-settings | MIT | |
| jsonschema | MIT | |
| fastapi | MIT | |
| uvicorn | BSD-3-Clause | |
| python-multipart | Apache-2.0 | |
| SQLAlchemy | MIT | |
| alembic | MIT | |
| psycopg | LGPL-3.0 (binary wheel bundles libpq under PostgreSQL license) | Dynamically linked; standard usage does not trigger LGPL source-disclosure obligations for the application code, but redistribute per LGPL terms if bundling. |
| scipy | BSD-3-Clause | |
| lightgbm | MIT | Legacy reference model only (not on the live risk path) |
| onnxruntime | MIT | |
| opencv-python-headless | Apache-2.0 (OpenCV itself); some optional OpenCV modules carry other licenses, not used here | |

## Frontend dependencies (`frontend/package.json`)

React, React Router, Vite, TypeScript: MIT. No other runtime dependencies at the time of writing (see
`frontend/package.json` for the exact list — **this environment has no network access to fetch/verify a live
`npm ls` or lockfile audit**, so this table is compiled from `package.json` alone; run `npm audit`/`npm ls` in an
environment with registry access before a production release).

## Model weights

| Model | Weight license | Restriction | Production consideration |
|---|---|---|---|
| YOLOX-nano | Apache-2.0 | None beyond attribution | Safe for commercial use |
| SCRFD `det_500m` (InsightFace buffalo_s) | **Non-commercial research use only** | Weights, not code, are restricted | **Must be replaced with a commercially-licensed or self-trained face detector before any commercial deployment** |
| ArcFace `w600k_mbf` (InsightFace buffalo_s) | **Non-commercial research use only** | Same pack, same restriction | Same — replace before commercial use |

The buffalo_s pack's bundled gender/age model is never extracted or loaded, independent of its license terms
(ETH-4: the system does not infer demographic attributes beyond what a detection task strictly requires).

## What still needs auditing before a production release

- A live `npm audit`/lockfile-based dependency audit for the frontend (blocked in this environment by no network
  access — see `FINAL_STATUS.md`).
- Confirmation of the exact commercial terms for any replacement face-detection/embedding models chosen before
  commercial deployment (see above).
- Legal review of the model-weight license summaries above; this document is an engineering-level audit, not legal
  advice.
