import { useEffect, useRef, useState } from "react";
import { CHART, fmtClock } from "../lib/format";

export interface Lane {
  label: string;
  color: string;
  intervals?: { start: number; end: number; title?: string; color?: string; id?: string }[];
  marks?: { t: number; title?: string }[];
}

/** Session timeline: one lane per signal, a shared time axis, optional playhead (all in ms). */
export function Timeline({
  durationMs,
  lanes,
  playheadMs,
  onSeek,
  highlightId,
  onIntervalClick,
}: {
  durationMs: number;
  lanes: Lane[];
  playheadMs?: number | null;
  onSeek?: (ms: number) => void;
  /** Interval id (e.g. a flag_id) to emphasise — keeps the timeline and flag list visually linked. */
  highlightId?: string | null;
  /** Clicking an interval that carries an id reports it, then the click does not also seek. */
  onIntervalClick?: (id: string, startMs: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(900);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const labelW = W < 520 ? 104 : 150;
  const laneH = 26;
  const top = 6;
  const axisH = 22;
  const H = top + lanes.length * laneH + axisH;
  const dur = Math.max(durationMs, 1000);
  const x = (ms: number) => labelW + (Math.min(Math.max(ms, 0), dur) / dur) * (W - labelW - 8);
  const maxTicks = Math.max(3, Math.floor((W - labelW) / 70));
  const stepMin = [1, 2, 5, 10, 15, 30, 60].find((m) => dur / (m * 60000) <= maxTicks) ?? 60;
  const secSteps = [5000, 10000, 15000, 30000, 60000];
  const stepMs = dur < 120000 ? (secSteps.find((m) => dur / m <= maxTicks) ?? 60000) : stepMin * 60000;
  const ticks: number[] = [];
  for (let t = 0; t <= dur; t += stepMs) ticks.push(t);

  return (
    <div className="timeline" ref={ref}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Session timeline"
        style={{ cursor: onSeek ? "pointer" : "default" }}
        onClick={(e) => {
          if (!onSeek) return;
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          if (px < labelW) return;
          onSeek(((px - labelW) / (W - labelW - 8)) * dur);
        }}
      >
        {lanes.map((lane, i) => {
          const y = top + i * laneH;
          return (
            <g key={lane.label}>
              <text x={0} y={y + 17} fontSize="12.5" fill={CHART.text}>
                {lane.label}
              </text>
              <rect x={labelW} y={y + 4} width={W - labelW - 8} height={laneH - 8} rx={3} fill={CHART.track} />
              {(lane.intervals ?? []).map((iv, k) => (
                <rect
                  key={k}
                  x={x(iv.start)}
                  y={y + 4}
                  width={Math.max(2, x(iv.end) - x(iv.start))}
                  height={laneH - 8}
                  rx={2}
                  fill={iv.color ?? lane.color}
                  stroke={iv.id && iv.id === highlightId ? CHART.ink : "none"}
                  strokeWidth={iv.id && iv.id === highlightId ? 2 : 0}
                  style={iv.id && onIntervalClick ? { cursor: "pointer" } : undefined}
                  onClick={
                    iv.id && onIntervalClick
                      ? (e) => {
                          e.stopPropagation();
                          onIntervalClick(iv.id!, iv.start);
                        }
                      : undefined
                  }
                >
                  {iv.title && <title>{iv.title}</title>}
                </rect>
              ))}
              {(lane.marks ?? []).map((m, k) => (
                <rect key={`m${k}`} x={x(m.t) - 1} y={y + 3} width={2} height={laneH - 6} fill={lane.color}>
                  {m.title && <title>{m.title}</title>}
                </rect>
              ))}
            </g>
          );
        })}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top} y2={H - axisH + 4} stroke={CHART.grid} strokeWidth={1} />
            <text x={x(t)} y={H - 4} fontSize="12" fill={CHART.textDim} textAnchor="middle">
              {fmtClock(t)}
            </text>
          </g>
        ))}
        {playheadMs != null && (
          <line x1={x(playheadMs)} x2={x(playheadMs)} y1={top - 2} y2={H - axisH + 6} stroke={CHART.ink} strokeWidth={2} />
        )}
      </svg>
    </div>
  );
}
