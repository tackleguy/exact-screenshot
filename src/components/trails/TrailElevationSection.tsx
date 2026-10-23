"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ElevationProfile } from "@/lib/trip/elevation";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: ElevationProfile };

const W = 800, H = 220, PAD_L = 52, PAD_R = 12, PAD_T = 12, PAD_B = 28;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

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
export function TrailElevationSection({ trailId }: { trailId: string }) {
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
      {load.state === "loading" && <div className="trail-elevation-loading" role="status" aria-label="Measuring elevation along the trail" />}
      {load.state === "error" && <p className="catalog-muted">{load.message}</p>}
      {load.state === "ready" && load.data.profile.length > 1 && <Chart e={load.data} />}
      {load.state === "ready" && load.data.profile.length <= 1 && <p className="catalog-muted">Elevation isn’t available for this trail’s line.</p>}
    </section>
  );
}

function Chart({ e }: { e: ElevationProfile }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
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
  // Steepest sustained grade over ~¼ mi windows, as a rough "how steep does it get". Only when samples are
  // close enough to resolve it (long trails are sampled every half mile or more), and never an implausible value
  // from a gap between mapped pieces.
  const steepest = useMemo(() => {
    const spacing = maxMile / Math.max(1, e.profile.length - 1);
    if (spacing > 0.08) return 0;
    let best = 0;
    for (let i = 0, j = 0; i < e.profile.length; i++) {
      while (j < e.profile.length && e.profile[j][0] - e.profile[i][0] < 0.25) j++;
      if (j >= e.profile.length) break;
      const run = (e.profile[j][0] - e.profile[i][0]) * 5280;
      if (run > 0) best = Math.max(best, Math.abs(e.profile[j][1] - e.profile[i][1]) / run);
    }
    return best > 1 ? 0 : Math.round(best * 100);
  }, [e, maxMile]);

  const pick = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const mi = ((clientX - box.left) / box.width * W - PAD_L) / (W - PAD_L - PAD_R) * maxMile;
    let best = 0;
    for (let i = 1; i < e.profile.length; i++) if (Math.abs(e.profile[i][0] - mi) < Math.abs(e.profile[best][0] - mi)) best = i;
    setHover(best);
  };
  const at = hover !== null ? e.profile[hover] : null;

  return (
    <>
      <dl className="trail-elevation-stats">
        <div><dt>Climb</dt><dd>{fmt(e.gainFt)} ft</dd></div>
        <div><dt>Descent</dt><dd>{fmt(e.lossFt)} ft</dd></div>
        <div><dt>Highest point</dt><dd>{fmt(e.maxFt)} ft</dd></div>
        <div><dt>Lowest point</dt><dd>{fmt(e.minFt)} ft</dd></div>
        {steepest > 0 && <div><dt>Steepest grade</dt><dd>{steepest}%</dd></div>}
      </dl>
      <figure className="trail-elevation-chart">
        <svg
          ref={ref}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Elevation from ${fmt(e.minFt)} to ${fmt(e.maxFt)} feet over ${maxMile} miles, ${fmt(e.gainFt)} feet of climbing`}
          onPointerMove={(ev) => pick(ev.clientX)}
          onPointerDown={(ev) => pick(ev.clientX)}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="trail-elev-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.45" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.04" />
            </linearGradient>
          </defs>
          {yTicks.map((v) => (
            <g key={`y${v}`}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} className="trail-elevation-grid" />
              <text x={PAD_L - 8} y={y(v) + 4} textAnchor="end" className="trail-elevation-tick">{fmt(v)}</text>
            </g>
          ))}
          {xTicks.map((v) => (
            <text key={`x${v}`} x={x(v)} y={H - 8} textAnchor="middle" className="trail-elevation-tick">{v === 0 ? "0" : `${+v.toFixed(2)} mi`}</text>
          ))}
          <path d={`${line}L${x(maxMile)},${H - PAD_B}L${PAD_L},${H - PAD_B}Z`} fill="url(#trail-elev-fill)" />
          <path d={line} className="trail-elevation-line" />
          {at && (
            <g>
              <line x1={x(at[0])} x2={x(at[0])} y1={PAD_T} y2={H - PAD_B} className="trail-elevation-cursor" />
              <circle cx={x(at[0])} cy={y(at[1])} r={5} className="trail-elevation-dot" />
            </g>
          )}
        </svg>
        <figcaption className="catalog-muted">
          {at ? <strong className="trail-elevation-readout">Mile {at[0].toFixed(1)} · {fmt(at[1])} ft</strong> : "Hover or drag across the chart to read the elevation at any point."}{" "}
          {e.partial ? "Part of the elevation data couldn’t be loaded, so these totals cover only part of the trail." : "Estimated from sampled ground elevation along the mapped line, in the direction the trail is mapped."}
        </figcaption>
      </figure>
    </>
  );
}
