import type { Difficulty } from "@/lib/types";

export type DifficultySource = "community" | "reported" | "estimated";

export interface DifficultyInput {
  name?: string | null;
  description?: string | null;
  miles?: number | null;
  elevationFt?: number | null;
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
 * Feature-based AI estimate when a source difficulty is missing.
 * Uses length, climb, and language cues — clearly labeled as estimated, never as measured.
 */
export function estimateDifficulty(input: DifficultyInput): TrailDifficulty {
  const text = `${input.name ?? ""} ${input.description ?? ""}`.toLowerCase();
  const fromText = normalizeDifficulty(text);
  if (fromText && /(easy|moderate|hard|expert|strenuous|beginner|scramble|technical)/.test(text)) {
    return fromText;
  }

  let score = 2; // baseline moderate
  const miles = Number.isFinite(input.miles) ? Math.max(0, Number(input.miles)) : null;
  const elev = Number.isFinite(input.elevationFt) ? Math.max(0, Number(input.elevationFt)) : null;

  if (miles != null) {
    // Short trails are easy unless the climb or the name says otherwise.
    if (miles < 1) score -= 0.8;
    else if (miles < 3) score -= 0.55;
    else if (miles < 6) score -= 0.1;
    else if (miles < 10) score += 0.25;
    else if (miles < 16) score += 0.7;
    else score += 1.15;
  }

  if (elev != null) {
    if (elev < 400) score -= 0.35;
    else if (elev < 1000) score += 0.1;
    else if (elev < 2000) score += 0.55;
    else if (elev < 3500) score += 1.0;
    else score += 1.4;

    if (miles && miles > 0) {
      const ftPerMile = elev / miles;
      if (ftPerMile > 800) score += 0.55;
      else if (ftPerMile > 500) score += 0.3;
      else if (ftPerMile < 150) score -= 0.2;
    }
  }

  if (/\b(summit|peak|ridge|pass|alpine|exposed|scramble|class\s*[345]|knife.?edge)\b/.test(text)) {
    score += 0.7;
  }
  if (/\b(loop|nature|boardwalk|interpretive|family|wheelchair|paved)\b/.test(text)) {
    score -= 0.35;
  }

  return scoreToDifficulty(Math.min(4.2, Math.max(1, score)));
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

  const reported = normalizeDifficulty(input.reported);
  if (reported) {
    return {
      difficulty: reported,
      label: ratingCount > 0
        ? `Source · ${ratingCount}/5 community ratings`
        : "Source reported",
      source: "reported",
      ratingCount,
    };
  }

  const estimated = estimateDifficulty(input);
  return {
    difficulty: estimated,
    label:
      ratingCount > 0
        ? `AI estimate · ${ratingCount}/5 community ratings`
        : "AI estimate",
    source: "estimated",
    ratingCount,
  };
}

export const DIFFICULTY_OPTIONS: { value: TrailDifficulty; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "moderate", label: "Moderate" },
  { value: "hard", label: "Hard" },
  { value: "expert", label: "Expert" },
];

export { COMMUNITY_THRESHOLD };
