"use client";

import { formatDistance, formatElevation } from "@/lib/units";
import type { GpsPoint } from "@/lib/types";
import { haversineMeters, metersToMiles } from "@/lib/gps";

interface ElevationChartProps {
  points: GpsPoint[];
  className?: string;
  height?: number;
}

export function ElevationChart({ points, className = "", height = 96 }: ElevationChartProps) {
  if (points.length < 2) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl bg-stone-100 text-xs text-stone-400 ${className}`}
        style={{ height }}
      >
        Elevation profile builds as you move
      </div>
    );
  }

  const samples: { distMi: number; altFt: number }[] = [];
  let distM = 0;

  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      distM += haversineMeters(
        points[i - 1].lat,
        points[i - 1].lng,
        points[i].lat,
        points[i].lng,
      );
    }
    const altFt =
      points[i].altitude !== null
        ? points[i].altitude! * 3.28084
        : samples.length > 0
          ? samples[samples.length - 1].altFt
          : 0;
    samples.push({ distMi: metersToMiles(distM), altFt });
  }

  const maxDist = Math.max(...samples.map((s) => s.distMi), 0.01);
  const alts = samples.map((s) => s.altFt);
  const minAlt = Math.min(...alts);
  const maxAlt = Math.max(...alts, minAlt + 1);
  const w = 320;
  const h = 90;
  const pad = 8;

  const pathD = samples
    .map((s, i) => {
      const x = (s.distMi / maxDist) * w;
      const y = h - pad - ((s.altFt - minAlt) / (maxAlt - minAlt)) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  const areaD = `${pathD} L ${w} ${h} L 0 ${h} Z`;

  const gridLines = [0.25, 0.5, 0.75].map((pct) => {
    const y = h - pad - pct * (h - pad * 2);
    const alt = minAlt + pct * (maxAlt - minAlt);
    return { y, alt };
  });

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full text-stone-300"
        style={{ height }}
        preserveAspectRatio="none"
      >
        {gridLines.map(({ y, alt }) => (
          <g key={y}>
            <line x1="0" y1={y} x2={w} y2={y} stroke="currentColor" strokeOpacity="0.3" />
            <text x="2" y={y - 2} fill="#78716c" fontSize="7">
              {formatElevation(alt)}
            </text>
          </g>
        ))}
        <path d={areaD} fill="#059669" fillOpacity="0.18" />
        <path d={pathD} fill="none" stroke="#059669" strokeWidth="2.5" />
        <circle
          cx={(samples[samples.length - 1].distMi / maxDist) * w}
          cy={
            h -
            pad -
            ((samples[samples.length - 1].altFt - minAlt) / (maxAlt - minAlt)) *
              (h - pad * 2)
          }
          r="3"
          fill="#059669"
        />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-stone-400">
        <span>0</span>
        <span>{formatDistance(maxDist)}</span>
        <span>
          ↑ {formatElevation(maxAlt - minAlt)} gain on chart
        </span>
      </div>
    </div>
  );
}
