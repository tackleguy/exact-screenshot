"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ElevationProfile } from "@/lib/trip/elevation";
import { steepestGrade } from "@/lib/trip/grade";
import { formatElevation, formatGrade, formatMeters, useUnits } from "@/lib/units";
import { emitTrailHover, onTrailHover } from "@/lib/trail-hover";
import { DIFFICULTY_COLORS } from "@/lib/trail-difficulty";

/** Measures the data build stored for the trail (shown instead of the chart's own sample when present). */
export interface StoredElevation { lossFt?: number | null; steepestGradePct?: number | null }

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: ElevationProfile };

/** Chart shading follows the trail's difficulty colour (the same colours as the difficulty chips). */
// Expert's near-black would vanish on the dark theme, so the chart draws it in the text colour.
const SHADE: Record<string, string> = { ...DIFFICULTY_COLORS, expert: "var(--foreground)" };

const W = 800, H = 220, PAD_L = 52, PAD_R = 12, PAD_T = 12, PAD_B = 28;
const fmt = (n: number) => (Math.round(n) || 0).toLocaleString("en-US"); // never "-0"

/** Rounded axis steps (1, 2, 2.5 or 5 × 10ⁿ) giving about `count` ticks over `span`. */
function step(span: number, count: number) {
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find((s) => s * mag >= raw) ?? 10) * mag;
}

/**
 * Elevation profile of a trail with a mapped line: climb, descent, high and low points and an interactive chart
 * (hover or drag to read the elevation at any mile). Sampled from AWS Terrain Tiles along the line.
 */
export function TrailElevationSection({ trailId, stored, difficulty }: { trailId: string; stored?: StoredElevation; difficulty?: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/trail-catalog/${encodeURIComponent(trailId)}/elevation`, { signal: controller.signal })
      .then(async (r) => { const data = await r.json(); if (!r.ok) throw new Error(data.error ?? "Elevation couldn’t be loaded."); setLoad({ state: "ready", data }); })
      .catch((e: Error) => { if (e.name !== "AbortError") setLoad({ state: "error", message: e.message }); });
    return () => controller.abort();
  }, [trailId]);

  return (
    <section className="trail-elevation" aria-labelledby="trail-elevation-heading">
      <h2 id="trail-elevation-heading">Elevation profile</h2>
      {load.state === "loading" && <div className="trail-elevation-loading" role="status"><span>Measuring elevation along the trail… long trails can take up to a minute.</span></div>}
      {load.state === "error" && <p className="catalog-muted">{load.message}</p>}
      {load.state === "ready" && load.data.profile.length > 1 && <Chart e={load.data} stored={stored} trailId={trailId} shade={SHADE[difficulty ?? ""] ?? "var(--accent)"} />}
      {load.state === "ready" && load.data.profile.length <= 1 && <p className="catalog-muted">Elevation isn’t available for this trail’s line.</p>}
    </section>
  );
}

function Chart({ e: raw, stored, trailId, shade }: { e: ElevationProfile; stored?: StoredElevation; trailId: string; shade: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const nearest = (mi: number) => {
    let best = 0;
    for (let i = 1; i < raw.profile.length; i++) if (Math.abs(raw.profile[i][0] - mi) < Math.abs(raw.profile[best][0] - mi)) best = i;
    return best;
  };
  // Hovering the trail on the map moves the chart's cursor to the same mile.
  useEffect(() => onTrailHover((h) => { if (h.trailId === trailId && h.from === "map") setHover(h.mile === null ? null : nearest(h.mile)); }));
  // The chart is drawn in the visitor's units: miles and feet, or kilometres and metres.
  const metric = useUnits() === "metric";
  const e = useMemo(() => (metric ? { ...raw, profile: raw.profile.map(([mi, ft]) => [mi * 1.609344, ft * 0.3048] as [number, number]), minFt: raw.minFt * 0.3048, maxFt: raw.maxFt * 0.3048, gainFt: raw.gainFt * 0.3048 } : raw), [raw, metric]);
  const distUnit = metric ? "km" : "mi", elevUnit = metric ? "m" : "ft";
  const maxMile = e.profile[e.profile.length - 1][0] || 1;
  // A little headroom above and below so flat trails don't look like cliffs.
  const span = Math.max(100, e.maxFt - e.minFt);
  const lo = Math.floor((e.minFt - span * 0.08) / 10) * 10, hi = Math.ceil((e.maxFt + span * 0.08) / 10) * 10;
  const x = (mi: number) => PAD_L + (mi / maxMile) * (W - PAD_L - PAD_R);
  const y = (ft: number) => PAD_T + (1 - (ft - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
  const line = useMemo(() => e.profile.map(([mi, ft], i) => `${i ? "L" : "M"}${x(mi).toFixed(1)},${y(ft).toFixed(1)}`).join(""), [e]); // eslint-disable-line react-hooks/exhaustive-deps
  const yStep = step(hi - lo, 4), xStep = step(maxMile, 6);
  const yTicks: number[] = []; for (let v = Math.ceil(lo / yStep) * yStep; v <= hi; v += yStep) yTicks.push(v);
  const xTicks: number[] = []; for (let v = 0; v <= maxMile + 1e-9; v += xStep) xTicks.push(v);
  // Steepest sustained grade: the data build's figure, else the same rule on this profile (5-sample smoothing,
  // 100 m windows), only when samples are close enough (under 50 m apart) to resolve it.
  const steepest = useMemo(() => {
    if (Number.isFinite(stored?.steepestGradePct)) return stored!.steepestGradePct as number;
    const along = raw.profile.map(([mi]) => mi * 1609.344), meters = raw.profile.map(([, ft]) => ft * 0.3048);
    const spacing = (along[along.length - 1] ?? 0) / Math.max(1, along.length - 1);
    return spacing <= 50 ? steepestGrade(along, meters) : null;
  }, [raw, stored]);
  // Long trails are sampled sparsely (a few hundred points), which misses most ups and downs: their profile shows
  // the shape, but no descent figure unless the data build measured one.
  const spacingM = ((raw.profile[raw.profile.length - 1]?.[0] ?? 0) * 1609.344) / Math.max(1, raw.profile.length - 1);
  const coarse = spacingM > 400;
  const descentFt = Number.isFinite(stored?.lossFt) ? (stored!.lossFt as number) : coarse ? null : raw.lossFt;

  const pick = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const frac = Math.max(0, Math.min(1, ((clientX - box.left) / box.width * W - PAD_L) / (W - PAD_L - PAD_R)));
    const best = nearest(frac * (raw.profile[raw.profile.length - 1][0] || 1));
    setHover(best);
    emitTrailHover({ trailId, mile: raw.profile[best][0], from: "chart" });
  };
  const leave = () => { setHover(null); emitTrailHover({ trailId, mile: null, from: "chart" }); };
  const at = hover !== null ? e.profile[hover] : null;
  // Grade at the cursor over about 100 m either side, for the tooltip.
  const gradeAt = (i: number) => {
    const p = raw.profile, a = p[Math.max(0, i - 2)], b = p[Math.min(p.length - 1, i + 2)];
    const run = (b[0] - a[0]) * 5280;
    return run > 0 ? Math.round(((b[1] - a[1]) / run) * 100) : null;
  };

  return (
    <>
      <dl className="trail-elevation-stats">
        {descentFt !== null && <div><dt>Descent</dt><dd>{formatElevation(descentFt)}</dd></div>}
        {formatGrade(steepest) && <div><dt>Steepest grade</dt><dd title="Steepest 100 m stretch after smoothing the elevation samples">{formatGrade(steepest)}</dd></div>}
      </dl>
      <figure className="trail-elevation-chart">
        <svg
          ref={ref}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Elevation from ${fmt(e.minFt)} to ${fmt(e.maxFt)} ${elevUnit} over ${maxMile.toFixed(1)} ${distUnit}`}
          onPointerMove={(ev) => pick(ev.clientX)}
          onPointerDown={(ev) => pick(ev.clientX)}
          onPointerLeave={leave}
        >
          <defs>
            <linearGradient id="trail-elev-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={shade} stopOpacity="0.5" />
              <stop offset="100%" stopColor={shade} stopOpacity="0.05" />
            </linearGradient>
          </defs>
          {yTicks.map((v) => (
            <g key={`y${v}`}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} className="trail-elevation-grid" />
              <text x={PAD_L - 8} y={y(v) + 4} textAnchor="end" className="trail-elevation-tick">{fmt(v)}</text>
            </g>
          ))}
          {xTicks.map((v) => (
            <text key={`x${v}`} x={x(v)} y={H - 8} textAnchor="middle" className="trail-elevation-tick">{v === 0 ? "0" : `${+v.toFixed(2)} ${distUnit}`}</text>
          ))}
          <path d={`${line}L${x(maxMile)},${H - PAD_B}L${PAD_L},${H - PAD_B}Z`} fill="url(#trail-elev-fill)" />
          <path d={line} className="trail-elevation-line" style={{ stroke: shade }} />
          {at && (
            <g>
              <line x1={x(at[0])} x2={x(at[0])} y1={PAD_T} y2={H - PAD_B} className="trail-elevation-cursor" />
              <circle cx={x(at[0])} cy={y(at[1])} r={5} className="trail-elevation-dot" />
              {(() => {
                const g = gradeAt(hover!), left = x(at[0]) > W - 170, tx = left ? x(at[0]) - 158 : x(at[0]) + 10;
                return (
                  <g className="trail-elevation-tooltip" transform={`translate(${tx},${PAD_T + 4})`}>
                    <rect width="148" height={g === null ? 40 : 58} rx="6" />
                    <text x="10" y="17">{at[0].toFixed(2)} {distUnit}</text>
                    <text x="10" y="34">{fmt(at[1])} {elevUnit}</text>
                    {g !== null && <text x="10" y="51">{g > 0 ? "+" : ""}{g}% grade</text>}
                  </g>
                );
              })()}
            </g>
          )}
        </svg>
        <figcaption className="catalog-muted">
          {at ? <strong className="trail-elevation-readout">{at[0].toFixed(1)} {distUnit} · {fmt(at[1])} {elevUnit}</strong> : "Hover or drag across the chart to read the elevation at any point."}{" "}
          {coarse ? `Simplified for a long trail: one sample every ${formatMeters(spacingM)}. ` : ""}{e.partial ? "Part of the elevation data couldn’t be loaded, so these totals cover only part of the trail." : "Estimated from sampled ground elevation along the mapped line, in the direction the trail is mapped."}
        </figcaption>
      </figure>
    </>
  );
}
