import { plainText } from "./format";
// Typed client for the ProctorStream API. All requests go to /api (proxied to the backend).

export const API = "/api";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function operatorName(): string {
  try {
    return localStorage.getItem("ps.operator") || "operator";
  } catch {
    return "operator";
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API + path, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        "X-Operator": operatorName(),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "The server could not be reached. Check that the API is running.");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const detail = (data as { detail?: unknown } | null)?.detail;
    const msg = typeof detail === "string" ? plainText(detail) : `The request failed (${res.status}).`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const api = {
  get: <T,>(p: string) => request<T>("GET", p),
  post: <T,>(p: string, b: unknown = {}) => request<T>("POST", p, b),
  put: <T,>(p: string, b: unknown) => request<T>("PUT", p, b),
};

/** Multipart upload with progress (fetch cannot report upload progress). */
export function uploadFile(
  path: string,
  fields: Record<string, string>,
  file: Blob,
  filename: string,
  onProgress?: (fraction: number) => void,
): { promise: Promise<unknown>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<unknown>((resolve, reject) => {
    const form = new FormData();
    Object.entries(fields).forEach(([k, v]) => form.append(k, v));
    form.append("file", file, filename);
    xhr.open("POST", API + path);
    xhr.setRequestHeader("X-Operator", operatorName());
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data: { detail?: string } | null = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, plainText(data?.detail) || `Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new ApiError(0, "The upload was interrupted. Check the connection and try again."));
    xhr.onabort = () => reject(new ApiError(0, "Upload cancelled."));
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

// ---- types (mirror backend/proctorstream_api/schemas.py) ----
export type SessionStatus =
  | "GENERATED" | "CREATED" | "CONSENTED" | "RECORDING" | "RECORDED" | "UPLOADED" | "PROCESSING"
  | "ANALYZING" | "COMPLETED" | "FAILED" | "REVIEWED" | "DELETED";

export interface Participant {
  id: string;
  code: string;
  status: "ACTIVE" | "WITHDRAWN";
  adult_confirmed: boolean;
  created_at: string;
  withdrawn_at: string | null;
  notes: string | null;
  consent_active: boolean;
  consent_version: string | null;
  session_count: number;
}
export interface Consent {
  id: string;
  consent_version: string;
  signed_name: string;
  ethics_reference: string | null;
  witnessed_by: string | null;
  signed_at: string;
  withdrawn_at: string | null;
  withdrawal_reason: string | null;
}
export interface ParticipantDetail extends Participant {
  consents: Consent[];
  has_demographics: boolean;
}
export interface Session {
  id: string;
  source: "SIMULATED" | "MOCK";
  status: SessionStatus;
  participant_id: string | null;
  participant_code: string | null;
  helper_participant_id: string | null;
  dataset_version: string | null;
  script_id: string | null;
  script_version: string | null;
  is_rehearsal: boolean;
  behavior_profile: string | null;
  lighting: string | null;
  webcam_class: string | null;
  room_noise: string | null;
  connection_stability: string | null;
  eyewear: boolean | null;
  head_covering: boolean | null;
  duration_s: number | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  ended_at: string | null;
  violation_label: boolean | null;
  split: string | null;
  risk?: number | null;
  risk_level?: string | null;
  degraded?: boolean | null;
  recommendation?: string | null;
}
export interface Recording {
  id: string;
  kind: "webcam_av" | "enrollment_image";
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  duration_s: number | null;
  width: number | null;
  height: number | null;
  status: "STORED" | "PURGED";
  created_at: string;
  retention_until: string | null;
  purged_at: string | null;
}
export interface Episode {
  episode_no: number;
  violation_type: string;
  instruction: string;
  scheduled_start_ms: number;
  scheduled_end_ms: number;
  shown_at_ms: number | null;
  completed_at_ms: number | null;
}
export interface Interval {
  start_ms: number;
  end_ms: number;
  type: string;
}
export interface Label {
  source: string;
  violation: boolean;
  violation_types: string[] | null;
  intervals: Interval[] | null;
  labeler: string | null;
  labeled_at: string | null;
  confidence: string | null;
}
export interface SessionDetail extends Session {
  notes: string | null;
  browser: Record<string, unknown> | null;
  channels_outage: string[] | null;
  baseline_movement: number | null;
  history: { from_status: string | null; to_status: string; actor: string; note: string | null; at: string }[];
  recordings: Recording[];
  episodes: Episode[];
  label: Label | null;
  event_counts: Record<string, number>;
  dead_letter_count: number;
}
export interface Page<T> {
  total: number;
  items: T[];
}
export interface ScriptDef {
  title: string;
  violation: boolean;
  profile: string;
  summary: string;
  requires_helper?: boolean;
  rehearsal?: boolean;
  episodes: { type: string; start_s: number; duration_s: number; instruction: string }[];
}
export interface ScriptsDoc {
  script_version: string;
  min_duration_s: number;
  max_duration_s: number;
  scripts: Record<string, ScriptDef>;
}
export interface Coverage {
  eligible_sessions: number;
  target_sessions: number;
  lighting_conditions: string[];
  webcam_conditions: string[];
  target_lighting_conditions: number;
  target_webcam_conditions: number;
  grid: Record<string, Record<string, number>>;
  by_script: Record<string, number>;
  active_participants: number;
  participants_recorded: number;
  met: boolean;
}
export interface TelemetryEvent {
  schema: string;
  session_id: string;
  ts_ms: number;
  channel: string;
  detector: string;
  detector_version: string;
  event_type: string;
  payload: Record<string, unknown>;
  confidence: number;
  quality: Record<string, unknown> | null;
}

// ---- analysis (Phases 4-7) ----
export type Recommendation = "NO_ACTION" | "ROUTINE_REVIEW" | "HUMAN_REVIEW" | "PRIORITY_REVIEW";
export type RiskLevel = "NORMAL" | "WATCH" | "ELEVATED" | "HIGH";
export interface Flag {
  flag_id: string;
  type: string;
  t_start_ms: number;
  t_end_ms: number;
  confidence: number;
  explanation: string;
  evidence_ref?: string | null;
  rule_id?: string;
  channel?: string;
  duration_s?: number;
  resulting_level?: RiskLevel;
  triggering_events?: string[];
}
export interface Assessment {
  schema: string;
  session_id: string;
  risk_level: RiskLevel;
  overall_risk: number;
  calibrated: boolean;
  recommendation: Recommendation;
  confidence_band: [number, number];
  flags: Flag[];
  top_contributors: { rule_id: string; flag_type: string; level: RiskLevel; explanation: string }[];
  channels_available: string[];
  channels_missing: string[];
  degraded?: boolean;
  engine?: string;
  model_version: string;
  rules_version?: string;
  feature_version: string;
  created_at?: string;
  reviews?: { verdict: string; note: string | null; reviewer: string; created_at: string }[];
}
export interface Job {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  stage: string | null;
  progress: number;
  message: string | null;
}

// ---- observability (SRS Section 20) ----
/** GET /metrics — point-in-time counters. Fields the environment cannot measure are null, not
 * fabricated; the UI must show those as an explicit "not measured" state, never as zero. */
export interface Metrics {
  active_sessions: number;
  event_count_total: number;
  dropped_or_rejected_events_total: number;
  detector_unknown_events_total: number;
  degraded_sessions: number | null;
  queue_depth: number | null;
  inference_latency_ms: number | null;
  ingest_latency_ms: number | null;
  time: string;
}
export interface SystemStatus {
  health: { status: string; version: string; contracts: string[]; checks: Record<string, string> };
  schema_revision: string;
  row_counts: Record<string, number>;
  storage: { backend: string; used_bytes: number; stored_recordings: number };
  channels: string[];
  consent_version: string;
  pipeline: { stage: string; state: "available" | "not_built" | "not_installed" }[];
}
/** GET /review-queue — counts are global (every scored session, independent of the ?tier filter),
 * so a single low-limit call is enough to read review-load and risk-distribution totals. */
export interface ReviewQueueItem {
  session_id: string;
  risk: number;
  risk_level?: RiskLevel;
  degraded?: boolean;
  recommendation: Recommendation;
  band: [number, number];
  n_flags: number;
  source: string;
  status: string;
  participant_code: string | null;
  lighting: string;
  webcam_class: string;
  duration_s: number;
  top_reason: string | null;
}
export interface ReviewQueue {
  total: number;
  counts: Record<string, number>;
  items: ReviewQueueItem[];
}
