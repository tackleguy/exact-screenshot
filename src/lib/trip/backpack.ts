/**
 * Backpacking along a trail: its campsites, water and towns in mile order, and which comes next from where the
 * hiker is now (the recorder's position placed on the trail line).
 */
import { groupOf, type FeatureType, type TrailFeature } from "@/lib/trail-catalog/features";
import type { TownNearTrail } from "./towns-core";

export type Stop =
  | { kind: "camp"; mile: number; name: string; type: FeatureType; offTrailFt: number; feature: TrailFeature }
  | { kind: "water"; mile: number; name: string; type: FeatureType; offTrailFt: number; feature: TrailFeature }
  | { kind: "town"; mile: number; name: string; milesOffTrail: number; town: TownNearTrail };

/** Shelters and huts count as places to sleep alongside campsites. */
const SLEEP: FeatureType[] = ["campsite", "camp_pitch", "shelter", "hut"];

/** Campsites, water and towns along the trail, in mile order. */
export function backpackStops(features: TrailFeature[], towns: TownNearTrail[]): Stop[] {
  const stops: Stop[] = [];
  for (const f of features) {
    if (SLEEP.includes(f.type)) stops.push({ kind: "camp", mile: f.mile, name: f.name, type: f.type, offTrailFt: f.offTrailFt, feature: f });
    else if (groupOf(f.type) === "water") stops.push({ kind: "water", mile: f.mile, name: f.name, type: f.type, offTrailFt: f.offTrailFt, feature: f });
  }
  for (const t of towns) stops.push({ kind: "town", mile: t.trailMile, name: t.name, milesOffTrail: t.milesOffTrail, town: t });
  return stops.sort((a, b) => a.mile - b.mile);
}

/** The next stop of each kind at or beyond `mile` (walking toward higher miles), with how far ahead it is. */
export function nextStops(stops: Stop[], mile: number | null): Partial<Record<Stop["kind"], { stop: Stop; milesAhead: number }>> {
  const out: Partial<Record<Stop["kind"], { stop: Stop; milesAhead: number }>> = {};
  if (mile === null) return out;
  for (const s of stops) {
    if (s.mile < mile - 0.05 || out[s.kind]) continue;
    out[s.kind] = { stop: s, milesAhead: Math.max(0, s.mile - mile) };
  }
  return out;
}
