import type { Difficulty } from "@/lib/types";

export type DifficultySource = "community" | "computed" | "reported" | "unknown";

export interface DifficultyInput {
  name?: string | null;
  description?: string | null;
  miles?: number | null;
  /** @deprecated elevation range; pass gainFt (measured climb) instead. */
  elevationFt?: number | null;
  /** Measured climb in feet along the trail (from a DEM profile). */
  gainFt?: number | null;
  /** OpenStreetMap sac_scale value. */
  sacScale?: string | null;
  reported?: string | null;
  communityDifficulty?: string | null;
  difficultyRatingCount?: number | null;
}

export interface ResolvedDifficulty {
  difficulty: Difficulty | "expert";
  label: string;
  source: DifficultySource;
  ratingCount: number;
}

const LEVELS = ["easy", "moderate", "hard", "expert"] as const;
export type TrailDifficulty = (typeof LEVELS)[number];

const COMMUNITY_THRESHOLD = 5;

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

export function scoreToDifficulty(score: number): TrailDifficulty {
  if (score < 1.5) return "easy";
  if (score < 2.5) return "moderate";
  if (score < 3.5) return "hard";
  return "expert";
}

export function averageDifficulties(levels: TrailDifficulty[]): TrailDifficulty | null {
  if (levels.length === 0) return null;
  const mean = levels.reduce((sum, level) => sum + difficultyScore(level), 0) / levels.length;
  return scoreToDifficulty(mean);
}

/**
 * The one difficulty scale (Easy · Moderate · Hard · Very hard), computed the same way for every trail:
 */
export const DIFFICULTY_FORMULA =
  "Effort = miles + 2 × (feet of climb ÷ 1,000), so 1,000 ft of climbing counts like 2 flat miles. Easy under 4, Moderate 4–9, Hard 9–16, Very hard 16 and over. The OpenStreetMap sac_scale tag sets a minimum: mountain_hiking is at least Moderate, demanding_mountain_hiking at least Hard, alpine_hiking or harder Very hard. Without a measured climb, distance alone is used.";

export const DIFFICULTY_LABELS: Record<TrailDifficulty, string> = { easy: "Easy", moderate: "Moderate", hard: "Hard", expert: "Very hard" };

const SAC_FLOOR: Record<string, TrailDifficulty> = {
  mountain_hiking: "moderate",
  demanding_mountain_hiking: "hard",
  alpine_hiking: "expert",
  demanding_alpine_hiking: "expert",
  difficult_alpine_hiking: "expert",
};

export function computeDifficulty({ miles, gainFt, sacScale }: { miles?: number | null; gainFt?: number | null; sacScale?: string | null }): TrailDifficulty | null {
  // Accepts the OSM value (mountain_hiking) or the "T3 Demanding Mountain" label form.
  const t = sacScale?.match(/^T(\d)/)?.[1];
  const floor = sacScale ? SAC_FLOOR[sacScale] ?? (t ? ([null, null, "moderate", "hard", "expert", "expert", "expert"] as const)[Number(t)] ?? null : null) : null;
  if (!Number.isFinite(miles) && !floor) return null;
  const effort = (Number.isFinite(miles) ? Number(miles) : 0) + (Number.isFinite(gainFt) ? (2 * Math.max(0, Number(gainFt))) / 1000 : 0);
  const fromEffort: TrailDifficulty = effort < 4 ? "easy" : effort < 9 ? "moderate" : effort < 16 ? "hard" : "expert";
  return floor && difficultyScore(floor) > difficultyScore(fromEffort) ? floor : fromEffort;
}

/** Naismith's rule: 3 mph plus an hour per 2,000 ft of climb. Null over 50 miles or without a measured climb. */
export function naismithHours(miles: number | null | undefined, gainFt: number | null | undefined) {
  if (!Number.isFinite(miles) || !Number.isFinite(gainFt) || Number(miles) <= 0 || Number(miles) >= 50) return null;
  return Number(miles) / 3 + Math.max(0, Number(gainFt)) / 2000;
}

export function resolveDifficulty(input: DifficultyInput): ResolvedDifficulty {
  const ratingCount = Math.max(0, Math.floor(Number(input.difficultyRatingCount) || 0));
  const community = normalizeDifficulty(input.communityDifficulty);
  if (community && ratingCount >= COMMUNITY_THRESHOLD) {
    return {
      difficulty: community,
      label: `Community average · ${ratingCount} ratings`,
      source: "community",
      ratingCount,
    };
  }
  const gainFt = input.gainFt ?? null;
  const computed = computeDifficulty({ miles: input.miles, gainFt, sacScale: input.sacScale });
  if (computed) {
    const basis = [Number.isFinite(input.miles) && "distance", Number.isFinite(gainFt) && "climb", input.sacScale && "terrain"].filter(Boolean).join(", ");
    return { difficulty: computed, label: `Computed from ${basis}`, source: "computed", ratingCount };
  }
  const reported = normalizeDifficulty(input.reported);
  if (reported) return { difficulty: reported, label: "Source reported", source: "reported", ratingCount };
  return { difficulty: "moderate", label: "Not enough data to rate", source: "unknown", ratingCount };
}

export const DIFFICULTY_OPTIONS: { value: TrailDifficulty; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "moderate", label: "Moderate" },
  { value: "hard", label: "Hard" },
  { value: "expert", label: "Expert" },
];

export { COMMUNITY_THRESHOLD };

/**
 * Climb that counts for effort: a loop's gain; for a line, whichever direction climbs more (data often runs
 * downhill, while hikers usually walk up it first).
 */
export function effortClimbFt(profile: { gainFt: number; lossFt: number } | null | undefined, routeType?: string | null) {
  if (!profile || !Number.isFinite(profile.gainFt)) return null;
  return routeType === "loop" ? profile.gainFt : Math.max(profile.gainFt, Number.isFinite(profile.lossFt) ? profile.lossFt : 0);
}
