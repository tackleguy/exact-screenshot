/**
 * "Trails near me": four cards chosen by a quality score rather than raw distance, with a mix of difficulties
 * (one easy, two moderate, one hard when the area has them) and a short "Why this trail" tag on each card.
 */
import type { CatalogTrail } from "./types";
import { trailDifficulty } from "../trail-difficulty";
import { landManager } from "./land-managers";
import { hasTrailWord } from "./naming";
import { distanceKm } from "./search";

export interface NearbyPick { trail: CatalogTrail; reason: string; score: number }
type Origin = { lat: number; lng: number; exact: boolean } | null;

const hasPhoto = (t: CatalogTrail) => Boolean(t.wiki?.image);
/** A name the source gave in full (not rebuilt by the name cleaner, not a placeholder). */
const fullName = (t: CatalogTrail) => !t.originalName && !/^unnamed/i.test(t.name) && t.name.trim().split(/\s+/).length >= 2 && hasTrailWord(t.name);

/**
 * Higher is a better card: photos (+25), a full trail name (+15), a known land manager (+15, +5 with an official
 * link), agency-verified (+10), a measured climb (+5), a day-hike length of 1–15 mi (+10), the catalog's own quality
 * score (up to +10); less up to 30 points for distance (0.6 per km from the visitor).
 */
export function nearbyQualityScore(t: CatalogTrail, origin: Origin = null): number {
  const manager = landManager(t);
  const miles = t.miles ?? 0;
  let score = (hasPhoto(t) ? 25 : 0) + (fullName(t) ? 15 : 0) + (manager ? 15 : 0) + (manager?.url ? 5 : 0);
  score += (t.tier === "verified" ? 10 : 0) + (Number.isFinite(t.gainFt) ? 5 : 0) + (miles >= 1 && miles <= 15 ? 10 : 0);
  score += Math.max(0, Math.min(10, (t.qualityScore ?? 0) / 10));
  if (origin) score -= Math.min(30, distanceKm(origin.lat, origin.lng, t.latitude, t.longitude) * 0.6);
  return score;
}

const SLOTS = ["easy", "moderate", "moderate", "hard"] as const;
const levelOf = (t: CatalogTrail) => { const d = trailDifficulty(t); return d === "expert" ? "hard" : d; };

/** The cards: best-scored trail per slot (easy, moderate, moderate, hard), any leftover slot filled by the best remaining. */
export function pickNearbyTrails(candidates: readonly CatalogTrail[], { origin = null, count = 4 }: { origin?: Origin; count?: number } = {}): NearbyPick[] {
  const seenNames = new Set<string>();
  const scored = candidates
    .filter((t) => t.kind !== "route" || (t.miles ?? 0) < 60)
    .map((trail) => ({ trail, score: nearbyQualityScore(trail, origin) }))
    .sort((a, b) => b.score - a.score || a.trail.id.localeCompare(b.trail.id))
    // One card per name (same-name pieces of one network).
    .filter(({ trail }) => { const k = trail.name.toLowerCase(); return !seenNames.has(k) && Boolean(seenNames.add(k)); });
  const used = new Set<string>();
  const chosen: { trail: CatalogTrail; score: number }[] = [];
  for (const level of SLOTS.slice(0, count)) {
    const hit = scored.find((x) => !used.has(x.trail.id) && levelOf(x.trail) === level);
    if (hit) { used.add(hit.trail.id); chosen.push(hit); }
  }
  for (const x of scored) {
    if (chosen.length >= count) break;
    if (!used.has(x.trail.id)) { used.add(x.trail.id); chosen.push(x); }
  }
  // Easy to hard, so the row reads as a range.
  const order = { easy: 0, moderate: 1, hard: 2 } as Record<string, number>;
  chosen.sort((a, b) => order[levelOf(a.trail)] - order[levelOf(b.trail)] || b.score - a.score);
  return withReasons(chosen, scored.map((x) => x.trail), origin);
}

/** One distinct, true "Why this trail" tag per card, compared with the other cards or every trail nearby. */
function withReasons(chosen: { trail: CatalogTrail; score: number }[], all: CatalogTrail[], origin: Origin): NearbyPick[] {
  const picks = chosen.map((c) => c.trail);
  const min = (list: CatalogTrail[], f: (t: CatalogTrail) => number | null | undefined) => list.reduce<CatalogTrail | null>((best, t) => { const v = f(t); return Number.isFinite(v) && (!best || v! < f(best)!) ? t : best; }, null);
  const max = (list: CatalogTrail[], f: (t: CatalogTrail) => number | null | undefined) => min(list, (t) => { const v = f(t); return Number.isFinite(v) ? -v! : null; });
  const away = (t: CatalogTrail) => (origin?.exact ? distanceKm(origin.lat, origin.lng, t.latitude, t.longitude) : null);
  const photographed = all.filter(hasPhoto);
  const best = chosen.reduce<{ trail: CatalogTrail; score: number } | null>((b, c) => (!b || c.score > b.score ? c : b), null);
  const rules: [string, (t: CatalogTrail) => boolean][] = [
    // Only when it is the one trail nearby with photos, so "most" is literally true.
    ["Most photographed nearby", (t) => hasPhoto(t) && photographed.length === 1 && photographed[0].id === t.id],
    ["Closest to you", (t) => origin?.exact === true && min(picks, away)?.id === t.id],
    ["Shortest climb", (t) => picks.filter((p) => Number.isFinite(p.gainFt)).length > 1 && min(picks, (p) => p.gainFt)?.id === t.id],
    ["Biggest climb nearby", (t) => (t.gainFt ?? 0) >= 500 && max(all, (p) => p.gainFt)?.id === t.id],
    ["Highest point nearby", (t) => Number.isFinite(t.maxElevFt) && max(all, (p) => p.maxElevFt)?.id === t.id],
    ["Longest day hike", (t) => (t.miles ?? 0) <= 20 && max(picks, (p) => ((p.miles ?? 0) <= 20 ? p.miles : null))?.id === t.id],
    ["Has trail photos", hasPhoto],
    ["Loop — no backtracking", (t) => t.routeType === "loop"],
    ["Verified by the land manager", (t) => t.tier === "verified"],
    ["Easy and short", (t) => levelOf(t) === "easy" && (t.miles ?? 99) <= 3],
    ["Best documented nearby", (t) => best?.trail.id === t.id],
    ["Shortest walk", (t) => min(picks, (p) => p.miles)?.id === t.id],
  ];
  const used = new Set<string>();
  return chosen.map(({ trail, score }) => {
    const rule = rules.find(([label, test]) => !used.has(label) && test(trail));
    const reason = rule?.[0] ?? (trail.tier === "verified" ? "Agency-mapped trail" : "Well-mapped trail");
    used.add(reason);
    return { trail, score, reason };
  });
}
