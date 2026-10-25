import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Rating } from "../types";

// ---------- thresholds & formatting (mirror src/vitals/metrics.js) ----------

export const LIMITS: Record<string, { good: number; poor: number; unit: "ms" | "score" }> = {
  lcp: { good: 2500, poor: 4000, unit: "ms" },
  inp: { good: 200, poor: 500, unit: "ms" },
  cls: { good: 0.1, poor: 0.25, unit: "score" },
  fcp: { good: 1800, poor: 3000, unit: "ms" },
  ttfb: { good: 800, poor: 1800, unit: "ms" },
  // Lighthouse lab-only metrics
  tbt: { good: 200, poor: 600, unit: "ms" },
  si: { good: 3400, poor: 5800, unit: "ms" }
};

export function rateValue(id: string, value: number | null | undefined): Rating | null {
  const l = LIMITS[id];
  if (!l || value === null || value === undefined || Number.isNaN(value)) return null;
  if (value <= l.good) return "good";
  if (value <= l.poor) return "needs-improvement";
  return "poor";
}

export function formatValue(id: string, value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (LIMITS[id]?.unit === "score") return value.toFixed(2);
  // 2500 → "2.5 s", 4000 → "4 s", 4770 → "4.77 s", 16140 → "16.1 s"
  if (value >= 1000) return `${Number((value / 1000).toFixed(value >= 10000 ? 1 : 2))} s`;
  return `${Math.round(value)} ms`;
}

const STATUS_VAR: Record<Rating, string> = {
  good: "var(--status-good)",
  "needs-improvement": "var(--status-warning)",
  poor: "var(--status-poor)"
};
const STATUS_ICON: Record<Rating, string> = { good: "✓", "needs-improvement": "!", poor: "✕" };

const PILL_TINT: Record<Rating, string> = {
  good: "bg-emerald-50 text-emerald-800 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-400/20",
  "needs-improvement": "bg-amber-50 text-amber-900 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-400/20",
  poor: "bg-red-50 text-red-800 ring-red-600/15 dark:bg-red-500/10 dark:text-red-200 dark:ring-red-400/20"
};

/** Status pill: icon + label + colour, so meaning never relies on colour alone. */
export function RatingPill({ rating, label, size = "sm" }: { rating: Rating | null; label: string; size?: "sm" | "md" }) {
  if (!rating) return <span className="text-xs text-slate-400">—</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium ring-1 ring-inset ${PILL_TINT[rating]} ${size === "md" ? "px-2.5 py-1 text-[13px]" : "px-2 py-0.5 text-xs"}`}>
      <span aria-hidden className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold leading-none text-white"
        style={{ background: STATUS_VAR[rating] }}>{STATUS_ICON[rating]}</span>
      {label}
    </span>
  );
}

/** Good / needs improvement / poor share of visits as one stacked bar with 2px gaps. */
export function DistributionBar({ distribution, labels }: {
  distribution: { good: number | null; needsImprovement: number | null; poor: number | null };
  labels: Record<Rating, string>;
}) {
  const parts: { rating: Rating; value: number }[] = [
    { rating: "good" as Rating, value: distribution.good ?? 0 },
    { rating: "needs-improvement" as Rating, value: distribution.needsImprovement ?? 0 },
    { rating: "poor" as Rating, value: distribution.poor ?? 0 }
  ].filter(p => p.value > 0);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div>
      <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded" role="img"
        aria-label={parts.map(p => `${labels[p.rating]} ${pct(p.value)}`).join(", ")}>
        {parts.map(p => (
          <div key={p.rating} title={`${labels[p.rating]}: ${pct(p.value)}`}
            className="h-full first:rounded-l last:rounded-r transition-opacity hover:opacity-80"
            style={{ width: `${p.value * 100}%`, background: STATUS_VAR[p.rating] }} />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
        {parts.map(p => (
          <span key={p.rating} className="inline-flex items-center gap-1">
            <span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: STATUS_VAR[p.rating] }} />
            {pct(p.value)}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------- trend chart ----------

export interface Series { key: string; label: string; color: string; values: (number | null)[] }

const HEIGHT = 170;
const PAD = { top: 12, right: 64, bottom: 24, left: 44 };

/**
 * Line chart of p75 over time for up to two series, with Google's good/poor
 * limits as thin reference lines. Crosshair + tooltip on hover and keyboard.
 */
export function TrendChart({ metricId, series, periods, locale, labels, zones = false, hideTable = false, formatPeriod, formatTick, height = HEIGHT }: {
  metricId: string;
  series: Series[];
  periods: string[];
  locale: string;
  labels: { good: string; poor: string; week: string; showTable: string };
  /** Shade the good / needs-improvement / poor ranges behind the lines. */
  zones?: boolean;
  /** Leave out the "show the numbers" table (when the page shows its own). */
  hideTable?: boolean;
  /** Label for one period in the tooltip and axis; defaults to "day month" of the ISO date. */
  formatPeriod?: (iso: string) => string;
  /** Short label for the time axis; with it, the axis is labelled at regular steps instead of only both ends. */
  formatTick?: (iso: string) => string;
  height?: number;
}) {
  const HEIGHT_PX = height;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const limits = LIMITS[metricId];
  const n = periods.length;
  const all = series.flatMap(s => s.values).filter((v): v is number => v !== null);
  if (!n || !all.length) return null;

  const yMax = Math.max(...all, limits.poor) * 1.12;
  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT_PX - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / yMax) * innerH;
  const fmtDate = formatPeriod ?? ((iso: string) => new Date(iso + "T00:00:00").toLocaleDateString(locale, { day: "numeric", month: "short" }));

  const path = (values: (number | null)[]) => {
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  // Round down, so the top label never lands above the chart (560 ms must not become 600).
  const ticks = [0, yMax / 2, yMax].map(v => (limits.unit === "score" ? Math.floor(v * 100) / 100 : Math.floor(v / 100) * 100));

  const onPointer = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.round(((px - PAD.left) / innerW) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowLeft") setHover(h => Math.max(0, (h ?? n) - 1));
    else if (e.key === "ArrowRight") setHover(h => Math.min(n - 1, (h ?? -1) + 1));
    else return;
    e.preventDefault();
  };

  // End labels: last non-null value of each series, nudged apart if they collide.
  const ends = series.map(s => {
    let i = s.values.length - 1;
    while (i >= 0 && s.values[i] === null) i--;
    return i >= 0 ? { s, i, v: s.values[i] as number, yy: y(s.values[i] as number) } : null;
  }).filter(Boolean) as { s: Series; i: number; v: number; yy: number }[];
  if (ends.length === 2 && Math.abs(ends[0].yy - ends[1].yy) < 14) {
    const [a, b] = ends[0].yy <= ends[1].yy ? [ends[0], ends[1]] : [ends[1], ends[0]];
    a.yy -= 7; b.yy += 7;
  }

  const tooltipLeft = hover !== null ? Math.min(Math.max(x(hover) / width * 100, 12), 82) : 0;

  return (
    <div ref={wrapRef} className="relative">
      <div className="mb-1 flex flex-wrap gap-x-4 text-xs text-slate-600 dark:text-slate-300">
        {series.map(s => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-4 rounded" style={{ background: s.color }} />{s.label}
          </span>
        ))}
      </div>

      <svg width={width} height={HEIGHT_PX} role="img" tabIndex={0}
        aria-label={series.map(s => `${s.label}: ${formatValue(metricId, ends.find(e => e.s === s)?.v)}`).join(", ")}
        className="block max-w-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        onPointerMove={onPointer} onPointerLeave={() => setHover(null)} onKeyDown={onKey} onBlur={() => setHover(null)}>
        {zones && (
          <g aria-hidden="true">
            <rect x={PAD.left} width={innerW} y={y(limits.good)} height={PAD.top + innerH - y(limits.good)} fill="var(--status-good)" opacity={0.12} />
            <rect x={PAD.left} width={innerW} y={y(limits.poor)} height={y(limits.good) - y(limits.poor)} fill="var(--status-warning)" opacity={0.16} />
            <rect x={PAD.left} width={innerW} y={PAD.top} height={Math.max(0, y(limits.poor) - PAD.top)} fill="var(--status-poor)" opacity={0.12} />
          </g>
        )}
        {ticks.map(t => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} fill="var(--chart-text)">
              {formatValue(metricId, t)}
            </text>
          </g>
        ))}

        {/* Google's limits as thin reference lines, labelled at the right edge (unless the zones show them) */}
        {([["good", limits.good, "var(--status-good)"], ["poor", limits.poor, "var(--status-poor)"]] as const).map(([k, v, c]) => (
          <g key={k}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke={c} strokeWidth={1} opacity={0.55} />
            {!zones && (
              <text x={width - PAD.right + 6} y={y(v)} dy="0.32em" fontSize={10} fill="var(--chart-text)">
                {labels[k]}
              </text>
            )}
          </g>
        ))}

        {formatTick ? (
          // A label every few periods, as many as fit about 80px apart, always including the latest.
          (() => {
            const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 80))));
            const idx = periods.map((_, i) => i).filter(i => (n - 1 - i) % step === 0);
            return idx.map(i => (
              <text key={i} x={x(i)} y={HEIGHT_PX - 6} fontSize={10} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fill="var(--chart-text)">
                {formatTick(periods[i])}
              </text>
            ));
          })()
        ) : (
          <>
            <text x={PAD.left} y={HEIGHT_PX - 6} fontSize={10} fill="var(--chart-text)">{fmtDate(periods[0])}</text>
            <text x={width - PAD.right} y={HEIGHT_PX - 6} fontSize={10} textAnchor="end" fill="var(--chart-text)">{fmtDate(periods[n - 1])}</text>
          </>
        )}

        {series.map(s => (
          <path key={s.key} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {ends.map(e => (
          <g key={e.s.key}>
            <circle cx={x(e.i)} cy={y(e.v)} r={4} fill={e.s.color} stroke="var(--chart-surface)" strokeWidth={2} />
            <text x={x(e.i) + 8} y={e.yy} dy="0.32em" fontSize={11} fontWeight={600} fill="currentColor"
              className="text-slate-700 dark:text-slate-200">{formatValue(metricId, e.v)}</text>
          </g>
        ))}

        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--chart-text)" strokeWidth={1} opacity={0.5} />
            {series.map(s => s.values[hover] !== null && (
              <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] as number)} r={4} fill={s.color} stroke="var(--chart-surface)" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>

      {hover !== null && (
        <div role="status" className="pointer-events-none absolute top-6 z-10 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800"
          style={{ left: `${tooltipLeft}%` }}>
          <div className="mb-1 text-slate-500 dark:text-slate-400">{labels.week} {fmtDate(periods[hover])}</div>
          {series.map(s => (
            <div key={s.key} className="flex items-center gap-2">
              <span aria-hidden className="h-0.5 w-3 rounded" style={{ background: s.color }} />
              <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{formatValue(metricId, s.values[hover])}</span>
              <span className="text-slate-500 dark:text-slate-400">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {!hideTable && <details className="mt-1 text-xs">
        <summary className="cursor-pointer text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">{labels.showTable}</summary>
        <div className="mt-2 max-h-48 overflow-auto">
          <table className="w-full text-left tabular-nums">
            <thead className="text-slate-500 dark:text-slate-400">
              <tr><th className="py-1 pr-3 font-medium">{labels.week}</th>{series.map(s => <th key={s.key} className="py-1 pr-3 font-medium">{s.label}</th>)}</tr>
            </thead>
            <tbody>
              {periods.map((p, i) => (
                <tr key={p} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1 pr-3">{fmtDate(p)}</td>
                  {series.map(s => <td key={s.key} className="py-1 pr-3">{formatValue(metricId, s.values[i])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>}
    </div>
  );
}

// ---------- gauge: where a value sits on Google's good / needs work / poor scale ----------

export function Gauge({ metricId, value, labels }: { metricId: string; value: number | null | undefined; labels: Record<Rating, string> }) {
  const l = LIMITS[metricId];
  const max = l.poor * 1.6;
  const rating = rateValue(metricId, value);
  const pos = value === null || value === undefined ? null : Math.min(value / max, 1) * 100;
  const zones: { r: Rating; from: number; to: number }[] = [
    { r: "good", from: 0, to: l.good },
    { r: "needs-improvement", from: l.good, to: l.poor },
    { r: "poor", from: l.poor, to: max }
  ];
  return (
    <div className="relative select-none pt-3" role="img"
      aria-label={value == null ? "" : `${formatValue(metricId, value)}: ${rating ? labels[rating] : ""}`}>
      {pos !== null && (
        <span aria-hidden className="absolute top-0 -translate-x-1/2 text-slate-800 transition-[left] duration-500 dark:text-slate-100" style={{ left: `${pos}%` }}>
          <svg width="10" height="7" viewBox="0 0 10 7"><path d="M0 0h10L5 7z" fill="currentColor" /></svg>
        </span>
      )}
      <div className="flex h-1.5 gap-[2px]">
        {zones.map((z, i) => (
          <div key={z.r} className={`h-full ${i === 0 ? "rounded-l-full" : ""} ${i === zones.length - 1 ? "rounded-r-full" : ""}`}
            style={{ width: `${((z.to - z.from) / max) * 100}%`, background: STATUS_VAR[z.r], opacity: rating === z.r ? 1 : 0.28 }} />
        ))}
      </div>
      <div className="relative mt-1 h-4 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
        {[l.good, l.poor].map(v => (
          <span key={v} className="absolute -translate-x-1/2" style={{ left: `${(v / max) * 100}%` }}>{formatValue(metricId, v)}</span>
        ))}
      </div>
    </div>
  );
}

// ---------- sparkline: compact 6-month trend, single series ----------

export function Sparkline({ values, rating, label }: { values: (number | null)[]; rating: Rating | null; label: string }) {
  const W = 88, H = 28, P = 3;
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 2) return null;
  const min = Math.min(...pts.map(p => p.v));
  const max = Math.max(...pts.map(p => p.v));
  const span = max - min || 1;
  const x = (i: number) => P + (i / (values.length - 1)) * (W - P * 2);
  const y = (v: number) => H - P - ((v - min) / span) * (H - P * 2);
  const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const last = pts[pts.length - 1];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="shrink-0 text-slate-400 dark:text-slate-500">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r={3.5} fill={rating ? STATUS_VAR[rating] : "currentColor"} stroke="var(--chart-surface)" strokeWidth={1.5} />
    </svg>
  );
}
