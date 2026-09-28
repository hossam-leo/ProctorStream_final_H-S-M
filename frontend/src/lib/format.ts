import type { SessionStatus } from "./api";

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
export function fmtInt(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString();
}
export function fmtPct(x: number | null | undefined, digits = 1): string {
  return x == null ? "—" : `${(x * 100).toFixed(digits)}%`;
}
export function titleCase(s: string | null | undefined): string {
  if (!s) return "—";
  const t = s.replace(/_/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export const STATUS_LABEL: Record<SessionStatus, string> = {
  GENERATED: "Generated",
  CREATED: "Created",
  CONSENTED: "Ready to record",
  RECORDING: "Recording",
  RECORDED: "Waiting for upload",
  UPLOADED: "Uploaded",
  PROCESSING: "Processing",
  ANALYZING: "Analyzing",
  COMPLETED: "Completed",
  FAILED: "Failed",
  REVIEWED: "Reviewed",
  DELETED: "Deleted",
};

export function statusTone(s: SessionStatus): "ok" | "warn" | "bad" | "info" | "neutral" | "live" {
  switch (s) {
    case "UPLOADED":
    case "COMPLETED":
    case "REVIEWED":
      return "ok";
    case "RECORDED":
    case "CREATED":
      return "warn";
    case "FAILED":
      return "bad";
    case "RECORDING":
      return "live";
    case "CONSENTED":
    case "PROCESSING":
    case "ANALYZING":
      return "info";
    default:
      return "neutral";
  }
}

export const VIOLATION_LABEL: Record<string, string> = {
  PHONE_USE: "Phone use",
  SECOND_PERSON: "Second person",
  IMPERSONATION: "Impersonation",
  TAB_SWITCH: "Tab switching",
  REMOTE_ASSISTANCE: "Remote assistance",
  NOTE_READING: "Reading notes",
};

export const LIGHTING = ["bright", "normal", "dim"] as const;
export const WEBCAMS = ["hd", "sd", "low"] as const;
export const NOISE = ["quiet", "moderate", "noisy"] as const;
export const WEBCAM_LABEL: Record<string, string> = { hd: "HD (720p+)", sd: "Standard (480p)", low: "Low (<480p)" };

export const REC_LABEL: Record<string, string> = {
  NO_ACTION: "No action",
  ROUTINE_REVIEW: "Routine review",
  HUMAN_REVIEW: "Human review",
  PRIORITY_REVIEW: "Priority review",
};
export function recTone(r: string | null | undefined): string {
  return r === "PRIORITY_REVIEW" ? "bad" : r === "HUMAN_REVIEW" ? "warn" : r === "ROUTINE_REVIEW" ? "info" : "ok";
}
export const VERDICT_LABEL: Record<string, string> = {
  NO_CONCERN: "No concern",
  CONCERN_CONFIRMED: "Concern confirmed",
  INCONCLUSIVE: "Inconclusive",
};
export function featureLabel(f: string): string {
  const [base, agg] = f.replace(/^bn_/, "").split("__");
  const nice = base.replace(/^x_/, "").replace(/_/g, " ");
  const a = agg ? ` (${agg.replace(/_/g, " ").replace(/^w(\d+)/, "$1 s window,")})` : "";
  return (f.startsWith("bn_") ? "vs own baseline: " : "") + nice + a;
}

/** Display-only wording for text that arrives from the server. The API's internal identifiers keep
 * their original names (they are contracts); people see "recorded" instead. */
export function plainText(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/\bmock[-_ ]sessions?\b/gi, (m) => (/s$/i.test(m) ? "recorded sessions" : "recorded session"))
    .replace(/\bmock (recordings?|corpus)\b/gi, "recorded $1")
    .replace(/\bmock\b/gi, "recorded");
}

// ---- risk levels (session_result.v1 / risk_assessment.v1: NORMAL < WATCH < ELEVATED < HIGH) ----
// Single source of truth for risk-level colour coding — used by RiskBadge and anywhere a bare
// risk level or recommendation tier needs a consistent tone across the app.
export const RISK_LEVELS = ["NORMAL", "WATCH", "ELEVATED", "HIGH"] as const;
export function riskTone(level: string | null | undefined): "ok" | "info" | "warn" | "bad" | "neutral" {
  switch (level) {
    case "HIGH":
    case "PRIORITY_REVIEW":
      return "bad";
    case "ELEVATED":
    case "HUMAN_REVIEW":
      return "warn";
    case "WATCH":
    case "ROUTINE_REVIEW":
      return "info";
    case "NORMAL":
    case "NO_ACTION":
      return "ok";
    default:
      return "neutral";
  }
}

// Dark-theme-safe SVG palette shared by the hand-rolled charts and the session timeline. The
// component-scoped literals that used to live in Timeline.tsx / Charts.tsx / SessionDetailPage.tsx
// assumed a light background (near-black text, near-white tracks) and were unreadable once the app
// moved to the dark design system — this is the single place to fix that.
export const CHART = {
  text: "#93a5b8",       // axis / tick labels
  textDim: "#5f7082",    // secondary labels
  grid: "rgba(163,185,207,0.14)",
  track: "rgba(255,255,255,0.07)",
  ink: "#eaf6fb",        // playhead / focal marks — must read clearly on dark panels
  accent: "#36c9dc",
  accent2: "#7c9bff",
  truth: "#ff6471",      // ground-truth violation — matches --bad
  cue: "#f5b84b",        // scripted cue — matches --warn
} as const;
