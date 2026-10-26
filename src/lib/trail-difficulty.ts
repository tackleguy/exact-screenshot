import type { Difficulty } from "@/lib/types";

const LEVELS = ["easy", "moderate", "hard", "expert"] as const;
export type TrailDifficulty = (typeof LEVELS)[number];

export function normalizeDifficulty(raw?: string | null): TrailDifficulty | null {
  if (!raw?.trim()) return null;
  const value = raw.trim().toLowerCase();
  if (LEVELS.includes(value as TrailDifficulty)) return value as TrailDifficulty;
  if (/(beginner|easy|green|class\s*1|yds\s*1)/.test(value)) return "easy";
  if (/(moderate|intermediate|blue|class\s*2|yds\s*2)/.test(value)) return "moderate";
  if (/(hard|difficult|strenuous|black|class\s*3|yds\s*3)/.test(value)) return "hard";
  if (/(expert|extreme|very\s*hard|scramble|technical|class\s*[45]|yds\s*[45])/.test(value)) {
    return "expert";
  }
  return null;
}

export function difficultyScore(level: TrailDifficulty): number {
  return LEVELS.indexOf(level) + 1;
}

/**
 * The one difficulty rating, used by the trail list, the map, page titles, the trail page and the data build:
 * effort = miles + feet of climb ÷ 500 (AllTrails-style). Easy under 4, Moderate 4–8, Hard 8–14, Expert over 14.
 */
export const DIFFICULTY_FORMULA =
  "Effort = miles + feet of climb ÷ 500. Easy under 4, Moderate 4–8, Hard 8–14, Expert over 14. A trail that climbs more than 800 ft per mile or tops out above 10,000 ft is rated one level harder (up to Hard), and one that climbs more than 2,000 ft is never Easy. Climb is measured along the mapped line from elevation data.";

export const DIFFICULTY_LABELS: Record<TrailDifficulty, string> = { easy: "Easy", moderate: "Moderate", hard: "Hard", expert: "Expert" };

export interface DifficultyMeasures {
  lengthMi?: number | null;
  /** Climb along the trail in feet (for a line, the larger of the climb in either direction). */
  gainFt?: number | null;
  /** Steepest sustained grade in percent; carried with the measures for display, not part of the rating. */
  steepestGradePct?: number | null;
  /** Highest point of the trail in feet. */
  maxElevFt?: number | null;
}

const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Difficulty from measured length and climb. Steep (more than 800 ft per mile) or high (above 10,000 ft) trails go
 * up one level, but a bump never makes a trail Expert — that takes an effort over 14. Anything climbing more than
 * 2,000 ft is at least Moderate. Null when the length is unknown.
 */
export function computeDifficulty({ lengthMi, gainFt, maxElevFt }: DifficultyMeasures): TrailDifficulty | null {
  if (!finite(lengthMi) || lengthMi < 0) return null;
  const gain = finite(gainFt) ? Math.max(0, gainFt) : 0;
  const effort = lengthMi + gain / 500;
  let level = effort < 4 ? 0 : effort < 8 ? 1 : effort <= 14 ? 2 : 3;
  const steep = lengthMi > 0 && gain / lengthMi > 800;
  const high = finite(maxElevFt) && maxElevFt > 10_000;
  if ((steep || high) && level < 2) level++;
  if (gain > 2000 && level === 0) level = 1;
  return LEVELS[level];
}

/** A catalog trail's difficulty from its stored measures (Moderate when even the length is unknown). */
export function trailDifficulty(t: { miles: number | null; gainFt?: number | null; steepestGradePct?: number | null; maxElevFt?: number | null }): TrailDifficulty {
  return computeDifficulty({ lengthMi: t.miles, gainFt: t.gainFt, steepestGradePct: t.steepestGradePct, maxElevFt: t.maxElevFt }) ?? "moderate";
}

/** Naismith's rule: 3 mph plus an hour per 2,000 ft of climb. Null over 50 miles or without a measured climb. */
export function naismithHours(miles: number | null | undefined, gainFt: number | null | undefined) {
  if (!Number.isFinite(miles) || !Number.isFinite(gainFt) || Number(miles) <= 0 || Number(miles) >= 50) return null;
  return Number(miles) / 3 + Math.max(0, Number(gainFt)) / 2000;
}

export const DIFFICULTY_OPTIONS: { value: TrailDifficulty; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "moderate", label: "Moderate" },
  { value: "hard", label: "Hard" },
  { value: "expert", label: "Expert" },
];


/**
 * Climb that counts for effort: a loop's gain; for a line, whichever direction climbs more (data often runs
 * downhill, while hikers usually walk up it first).
 */
export function effortClimbFt(profile: { gainFt: number; lossFt: number } | null | undefined, routeType?: string | null) {
  if (!profile || !Number.isFinite(profile.gainFt)) return null;
  return routeType === "loop" ? profile.gainFt : Math.max(profile.gainFt, Number.isFinite(profile.lossFt) ? profile.lossFt : 0);
}
