"use client";

import { formatDistance, formatElevation } from "@/lib/units";
import type { ElevationSample } from "@/lib/types";

interface TrailElevationProfileProps {
  samples: ElevationSample[];
  className?: string;
  height?: number;
}

export function TrailElevationProfile({
  samples,
  className = "",
  height = 120,
}: TrailElevationProfileProps) {
  if (samples.length < 2) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl border border-stone-200 bg-stone-50 text-sm text-stone-500 ${className}`}
        style={{ height }}
      >
        Elevation profile not available for this trail yet.
      </div>
    );
  }

  const normalized = samples.map((s) => ({
    distMi: s.distance_m / 1609.344,
    altFt:
      s.elevation_ft ??
      (s.elevation_m != null ? s.elevation_m * 3.28084 : 0),
  }));

  const maxDist = Math.max(...normalized.map((s) => s.distMi), 0.01);
  const alts = normalized.map((s) => s.altFt);
  const minAlt = Math.min(...alts);
  const maxAlt = Math.max(...alts, minAlt + 1);
  const w = 360;
  const h = 100;
  const pad = 8;

  const pathD = normalized
    .map((s, i) => {
      const x = (s.distMi / maxDist) * w;
      const y = h - pad - ((s.altFt - minAlt) / (maxAlt - minAlt)) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  const areaD = `${pathD} L ${w} ${h} L 0 ${h} Z`;

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full text-stone-300"
        style={{ height }}
        preserveAspectRatio="none"
        role="img"
        aria-label="Trail elevation profile"
      >
        <path d={areaD} fill="#059669" fillOpacity="0.15" />
        <path d={pathD} fill="none" stroke="#059669" strokeWidth="2.5" />
      </svg>
      <div className="mt-2 flex justify-between text-xs text-stone-500">
        <span>0</span>
        <span>{formatDistance(maxDist)}</span>
        <span>↑ {formatElevation(maxAlt - minAlt)}</span>
      </div>
    </div>
  );
}
