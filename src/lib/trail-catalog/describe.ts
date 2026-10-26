/**
 * Plain-English summary and highlight chips for a trail page, written from the trail's measured facts when no
 * official or Wikipedia description exists.
 */
import type { CatalogTrail } from "./types";
import { countryName } from "./types";
import type { FeatureType } from "./features";
import { DIFFICULTY_LABELS, type TrailDifficulty } from "../trail-difficulty";
import { formatDistance, formatElevation, type Units } from "../units";

const SHAPE: Record<string, string> = { loop: "loop", "out-and-back": "out-and-back", "point-to-point": "point-to-point", segment: "trail segment", network: "trail segment" };
const USE: [RegExp, string][] = [[/hik|foot|walk/i, "hiking"], [/bike|bicycle|mtb/i, "mountain biking"], [/horse/i, "horseback riding"], [/run/i, "trail running"], [/ski/i, "skiing"], [/snowshoe/i, "snowshoeing"]];

/** "Yosemite Falls Trail is a 3.0-mile out-and-back trail in Yosemite National Park, California. …" */
export function describeTrail(t: CatalogTrail, { difficulty, time, units }: { difficulty: TrailDifficulty; time?: string | null; units?: Units }): string {
  const where = t.park ?? t.forest ?? t.blmArea ?? null;
  const place = [where, t.region ?? countryName(t.country)].filter(Boolean).join(", ");
  const length = formatDistance(t.miles, units);
  const shape = SHAPE[t.routeType ?? ""] ?? "trail";
  const article = /^[aeiou8]/i.test(length ?? shape) ? "an" : "a";
  const lead = length ? `${t.name} is ${article} ${length} ${shape}${shape.endsWith("trail segment") || shape === "trail" ? "" : " trail"}` : `${t.name} is ${article} ${shape}${shape === "trail" ? "" : " trail"}`;
  const out = [`${lead}${place ? ` in ${place}` : ""}.`];
  const gain = formatElevation(t.gainFt, units);
  const level = DIFFICULTY_LABELS[difficulty]?.toLowerCase() ?? difficulty;
  const effort = gain ? `Generally considered ${level === "easy" ? "an" : level === "expert" ? "an" : "a"} ${level} route, it climbs about ${gain}` : `Generally considered ${level === "easy" || level === "expert" ? "an" : "a"} ${level} route`;
  out.push(`${effort}${time ? ` and takes ${/^\d/.test(time) ? "about " : ""}${time} to complete` : ""}.`);
  const high = formatElevation(t.maxElevFt, units);
  if (high && (t.maxElevFt ?? 0) >= 5000) out.push(`It tops out at ${high}.`);
  const uses = [...new Set(USE.filter(([re]) => (t.uses ?? []).some((u) => re.test(u))).map(([, label]) => label))];
  if (uses.length) out.push(`Popular for ${uses.length > 1 ? `${uses.slice(0, -1).join(", ")} and ${uses[uses.length - 1]}` : uses[0]}.`);
  if (t.dogs === true) out.push("Dogs are welcome.");
  else if (t.dogs === false) out.push("Dogs aren’t allowed.");
  return out.join(" ");
}

const NAME_HIGHLIGHTS: [RegExp, string][] = [
  [/\b(falls?|waterfalls?|cascades?)\b/i, "Waterfall"],
  [/\b(lakes?|ponds?|reservoir|tarn)\b/i, "Lake"],
  [/\b(rivers?|creeks?|brook|stream)\b/i, "River"],
  [/\b(beach|coast|coastal|shore|bluffs?)\b/i, "Beach"],
  [/\b(peak|summit|mount|mt\.?|mountain|dome|butte)\b/i, "Summit"],
  [/\b(canyon|gorge|gulch|narrows)\b/i, "Canyon"],
  [/\b(views?|vista|overlook|lookout|point)\b/i, "Views"],
  [/\b(forest|woods|grove|redwoods?)\b/i, "Forest"],
  [/\b(meadows?|prairie)\b/i, "Wildflowers"],
  [/\b(caves?|arch(es)?)\b/i, "Rock formations"],
];
const FEATURE_HIGHLIGHTS: Partial<Record<FeatureType, string>> = { waterfall: "Waterfall", lake: "Lake", river: "River", viewpoint: "Views", peak: "Summit", campsite: "Camping", camp_pitch: "Camping", shelter: "Shelter", hut: "Hut", spring: "Water source", drinking_water: "Water source", picnic_site: "Picnic area", pass: "Mountain pass" };

/** Short chips for the trail page: from the name, the features mapped along the line and the trail's facts. */
export function trailHighlights(t: Pick<CatalogTrail, "name" | "routeType" | "dogs" | "maxElevFt" | "winterUse" | "uses">, features: FeatureType[] = []): string[] {
  const out = new Set<string>();
  for (const [re, label] of NAME_HIGHLIGHTS) if (re.test(t.name)) out.add(label);
  for (const f of features) { const label = FEATURE_HIGHLIGHTS[f]; if (label) out.add(label); }
  if (t.routeType === "loop") out.add("Loop");
  if (t.dogs === true) out.add("Dog friendly");
  if ((t.maxElevFt ?? 0) >= 10000) out.add("High elevation");
  if (t.winterUse) out.add("Winter");
  return [...out].slice(0, 8);
}
