"use client";

import { formatElevation } from "@/lib/units";
import { formatCoordinate } from "@/lib/gps";
import type { GpsQuality } from "@/components/gps/useGpsTrack";

interface GpsStatsPanelProps {
  lat: number | null;
  lng: number | null;
  speedMph: number;
  altitudeFt: number | null;
  heading: number | null;
  accuracy: number | null;
  quality: GpsQuality;
  pointCount: number;
  className?: string;
}

const qualityStyles: Record<GpsQuality, string> = {
  excellent: "bg-emerald-100 text-emerald-800",
  good: "bg-emerald-50 text-emerald-700",
  fair: "bg-amber-100 text-amber-800",
  poor: "bg-red-100 text-red-800",
  unknown: "bg-stone-100 text-stone-600",
};

const qualityLabels: Record<GpsQuality, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  unknown: "Waiting…",
};

function headingLabel(deg: number | null): string {
  if (deg === null) return "—";
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return `${Math.round(deg)}° ${dirs[Math.round(deg / 45) % 8]}`;
}

export function GpsStatsPanel({
  lat,
  lng,
  speedMph,
  altitudeFt,
  heading,
  accuracy,
  quality,
  pointCount,
  className = "",
}: GpsStatsPanelProps) {
  return (
    <div
      className={`rounded-2xl border border-stone-200 bg-stone-900 p-4 font-mono text-xs text-stone-300 ${className}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">
          GPS Instrumentation
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${qualityStyles[quality]}`}
        >
          {qualityLabels[quality]}
          {accuracy !== null ? ` · ±${Math.round(accuracy)}m` : ""}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <Stat label="Latitude" value={lat !== null ? formatCoordinate(lat, true) : "—"} />
        <Stat label="Longitude" value={lng !== null ? formatCoordinate(lng, false) : "—"} />
        <Stat label="Speed" value={`${speedMph.toFixed(1)} mph`} highlight />
        <Stat
          label="Altitude"
          value={formatElevation(altitudeFt) ?? "—"}
          highlight
        />
        <Stat label="Heading" value={headingLabel(heading)} />
        <Stat label="Track pts" value={String(pointCount)} />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-stone-500">{label}</p>
      <p className={`tabular-nums ${highlight ? "text-emerald-400" : "text-stone-200"}`}>
        {value}
      </p>
    </div>
  );
}
