# Privacy and ethics

## Consent and recording transparency

- **Informed consent**: a versioned consent form (`docs/consent/CONSENT_FORM.md`) must be recorded before a
  session can be created; the API rejects session creation against a stale consent version
  (`backend/proctorstream_api/routers/participants.py`).
- **Visible recording indicator**: the live recording view shows a persistent "● Recording" badge and elapsed
  timer directly on the camera preview (`frontend/src/pages/RecordPage.tsx`) — there is no way to record without
  it being visibly shown to the person being recorded.
- **No hidden recording**: recording only starts from this same explicit, visible flow; there is no background or
  silent capture path in the client.
- **No under-18 deployment**: participant creation requires `adult_confirmed = true`, enforced by a database CHECK
  constraint (`ck_participants_adult` in `backend/proctorstream_api/models.py`), not just client-side validation.

## Data handling

- **Deletion workflow**: implemented (`backend/proctorstream_api/services/purge.py`) — consent withdrawal, per-session
  deletion (`POST /sessions/{id}/delete`, requires an explicit confirmation and reason, recorded in the audit
  trail), and a project-end media purge path. Raw recordings are stated as deleted at the end of the project in
  every generated HTML report footer.
- **Encrypted recordings**: **not implemented in this environment.** Storage (`backend/proctorstream_api/storage.py`)
  writes to local disk (dev) or an S3-compatible backend (prod config) without an encryption-at-rest layer of its
  own; encryption would need to come from the underlying storage backend (e.g. S3 SSE, an encrypted filesystem) —
  this is a deployment-configuration responsibility that should be set explicitly before handling real recordings,
  and is called out here rather than assumed. Status: **NOT IMPLEMENTED at the application layer.**
- **Biometric template separation**: **partially implemented.** Identity/liveness embeddings are computed
  transiently per analysis run from the stored enrolment photo (`extract_recording`) and are not persisted to a
  separate table — so there is no long-lived biometric template store to separately secure, but this also means
  there is no dedicated access-controlled biometric store as the SRS envisions, either. The enrolment photo itself
  is stored as regular session media, not segregated with stricter access controls. Status: **PARTIAL — no
  standing biometric template store exists, but the enrolment photo is not currently segregated from other
  session media with additional access controls.** Treat this as a gap to close before handling real biometric
  data at scale.

## Privacy analysis

- The system is designed so that **missing evidence never increases risk** (see `docs/RISK_ENGINE.md`) — a
  candidate whose camera drops, whose environment channel is unavailable, or whose connection is unstable is never
  penalised for that unavailability. This is a privacy- and fairness-relevant design choice: it avoids creating an
  incentive structure where candidates with worse equipment or connectivity (often correlated with socioeconomic
  factors) are treated as more suspicious by default.
- The risk engine never outputs a `VIOLATION` level or verdict — only a review recommendation for a human. All
  identified concerns are reviewed by a person before any consequence follows.
- Reviewer decisions are stored separately from any training/simulation labels, so review outcomes cannot silently
  become "ground truth" that then biases downstream simulator calibration without a human explicitly deciding so.

## Security / adversarial analysis

- **Liveness/anti-spoof**: implemented as a heuristic PAD (presentation-attack-detection) check; like any
  heuristic liveness check it is not resistant to a sophisticated, well-lit deepfake or a high-quality mask — flag
  this explicitly to any deployer considering high-stakes use.
- **Virtual camera detection**: implemented in Tier 0 client signals to catch a common, low-effort spoofing vector
  (routing a pre-recorded or synthetic video feed through a virtual camera driver instead of a real device); it
  returns `UNKNOWN` rather than a false negative when it cannot determine device authenticity, consistent with the
  never-fabricate-a-detection principle used throughout.
- **Threshold gaming**: because the rule engine's thresholds are legible (an engineer or, if leaked, a
  sophisticated candidate could read `configs/risk.yaml`), someone could in principle try to stay just under a
  duration/count threshold (e.g. put a phone away right before 30 seconds). This is an inherent trade-off of
  transparent, deterministic rules versus an opaque learned model: transparency and auditability were required by
  the SRS (CON-8) at the cost of some gameability. The multi-signal escalation rule (3+ independent concern types
  → escalate) partially mitigates single-signal threshold-skirting by looking at co-occurring concerns rather than
  any one signal in isolation.
- **Telemetry integrity**: `telemetry.v1` includes an `integrity` field as an abstraction point for a future
  telemetry-signing scheme (to detect tampered/replayed client telemetry) but no signing scheme is implemented in
  this environment — telemetry is currently trusted as sent. Flag before relying on telemetry as tamper-evident.
