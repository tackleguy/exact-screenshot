"use client";

import { DIFFICULTY_FORMULA, DIFFICULTY_LABELS, type TrailDifficulty, DIFFICULTY_COLORS } from "@/lib/trail-difficulty";
import { ROUTE_TYPE_LABELS, type RouteType } from "@/lib/trail-catalog/quality";
import { formatDistance, formatDuration, formatDurationRange, formatElevation, hikingHours, splitDescent, useUnits } from "@/lib/units";
import "./trail-stats.css";

export interface TrailStatsInput {
  miles: number | null;
  gainFt?: number | null;
  lossFt?: number | null;
  steepestGradePct?: number | null;
  minElevFt?: number | null;
  maxElevFt?: number | null;
  routeType?: RouteType | null;
  difficulty: TrailDifficulty;
  /** Long routes and through-hikes get no time estimate (they take days). */
  multiDay?: boolean;
}

const DOT = DIFFICULTY_COLORS;

/** Hiking time from a trail's stored measures; a range for Hard and Expert trails ("3–4 h"). */
export function estimatedTime(t: TrailStatsInput): string | null {
  if (t.multiDay || t.miles === null || t.miles >= 50) return null;
  const hours = hikingHours({ miles: t.miles, gainFt: t.gainFt, ...splitDescent(t.lossFt, t.steepestGradePct) });
  if (hours === null) return null;
  return t.difficulty === "hard" || t.difficulty === "expert" ? formatDurationRange(hours, hours * 1.3) : formatDuration(hours);
}

/**
 * The one stats grid for a trail — Length, Elevation gain, Est. time, Route type, Difficulty — used on the map's
 * trail card and the trail page; the trail page adds Highest and Lowest point.
 */
export function TrailStats({ trail: t, detail = false, compact = false }: { trail: TrailStatsInput; detail?: boolean; compact?: boolean }) {
  useUnits();
  const time = estimatedTime(t);
  const items: [string, React.ReactNode, string?][] = [];
  const length = formatDistance(t.miles);
  if (length) items.push(["Length", length]);
  const gain = formatElevation(t.gainFt);
  if (gain) items.push(["Elevation gain", gain, t.routeType === "loop" ? undefined : "The larger of the climb in either direction along the trail"]);
  if (time) items.push(["Est. time", time, "Naismith's rule with Langmuir's corrections: 3 mph (5 km/h), +1 h per 2,000 ft climbed, +1 h per 1,000 ft of steep descent, −10 min per 1,000 ft of gentle descent"]);
  if (t.routeType) items.push(["Route type", ROUTE_TYPE_LABELS[t.routeType]]);
  items.push(["Difficulty", <><i className="trail-stats-dot" style={{ background: DOT[t.difficulty] }} aria-hidden="true" />{DIFFICULTY_LABELS[t.difficulty]}</>, DIFFICULTY_FORMULA]);
  if (detail) {
    const high = formatElevation(t.maxElevFt), low = formatElevation(t.minElevFt);
    if (high) items.push(["Highest point", high]);
    if (low) items.push(["Lowest point", low]);
  }
  return (
    <dl className={`trail-stats-grid${compact ? " trail-stats-grid--compact" : ""}`}>
      {items.map(([label, value, title]) => (
        <div key={label}><dt>{label}</dt><dd title={title}>{value}</dd></div>
      ))}
    </dl>
  );
}
