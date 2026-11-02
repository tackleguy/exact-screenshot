/**
 * Plain-English summary and highlight chips for a trail page, written from the trail's measured facts when no
 * official or Wikipedia description exists.
 */
import type { CatalogTrail } from "./types";
import { countryName } from "./types";
import type { FeatureType } from "./features";
import { DIFFICULTY_LABELS, type TrailDifficulty } from "../trail-difficulty";
import { formatDistance, formatElevation, type Units } from "../units";

import { landManager } from "./land-managers";

/** A piece of a description: plain text, or a link (the land manager's official page). */
export type DescriptionPart = string | { text: string; href: string };

/** How the climbing is spread along the trail, read from the elevation profile (or the stored climb and range). */
export type ProfileShape = "flat" | "steady-climb" | "summit" | "ridge" | "rolling" | "gentle";

/**
 * Shape of a one-way elevation profile ([mile, ft] pairs):
 * flat (under ~150 ft of relief), steady climb (the climb is about the range and the high point is at an end),
 * summit (one climb to a high point mid-way), ridge (stays near the high point for much of the way),
 * rolling (climbing adds up to well over the range: repeated ups and downs).
 */
export function profileShape(profile: [number, number][] | null | undefined, stored?: { gainFt?: number | null; minElevFt?: number | null; maxElevFt?: number | null }): ProfileShape | null {
  if (profile && profile.length >= 6) {
    const ft = profile.map((p) => p[1]);
    const min = Math.min(...ft), max = Math.max(...ft), range = max - min;
    let gain = 0, low = ft[0];
    // Climb with 15 ft hysteresis so DEM noise doesn't read as rolling terrain.
    for (const e of ft) { if (e < low) low = e; else if (e - low >= 15) { gain += e - low; low = e; } }
    if (range < 150) return "flat";
    const total = profile[profile.length - 1][0] - profile[0][0] || 1;
    const at = (profile[ft.indexOf(max)][0] - profile[0][0]) / total;
    const high = ft.filter((e) => e >= max - range * 0.2).length / ft.length;
    const ratio = gain / range;
    if (ratio > 2.2) return "rolling";
    if (high >= 0.4 && at > 0.15 && at < 0.85) return "ridge";
    if (at <= 0.15 || at >= 0.85) return ratio < 1.5 ? "steady-climb" : "rolling";
    return "summit";
  }
  const gain = stored?.gainFt, lo = stored?.minElevFt, hi = stored?.maxElevFt;
  if (!Number.isFinite(gain)) return null;
  const range = Number.isFinite(lo) && Number.isFinite(hi) ? hi! - lo! : null;
  if ((range ?? gain!) < 150 && gain! < 250) return "flat";
  if (range && range > 0) {
    const ratio = gain! / range;
    if (ratio > 2.2) return "rolling";
    if (ratio < 1.35) return "steady-climb";
  }
  return "gentle";
}

/** Tiny stable hash of a trail id, so each trail always reads the same but neighbours read differently. */
function seed(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}
const pick = <T,>(options: T[], n: number) => options[n % options.length];
const an = (word: string) => (/^(8|11(\D|$)|18(\D|$))|^[aeiou]/i.test(word) ? "an" : "a");
const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const NUMBER = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const count = (n: number, one: string, many: string) => (n === 1 ? `${an(one)} ${one}` : `${n < 10 ? NUMBER[n] : n} ${many}`);

/** "Burton Trail" from the display name "Burton Trail — Angeles National Forest". */
const baseName = (name: string) => name.split(" — ")[0];

/** What the trail passes, from the "Along the trail" features: named lakes and falls first, then counts. */
function featurePhrase(features: { type: FeatureType; name?: string | null }[]): string | null {
  const named = (types: FeatureType[]) => [...new Set(features.filter((f) => types.includes(f.type) && f.name && !/^(lake|river|waterfall|spring|viewpoint|peak|campsite|shelter)$/i.test(f.name)).map((f) => f.name!))];
  const n = (types: FeatureType[]) => features.filter((f) => types.includes(f.type)).length;
  const parts: string[] = [];
  const falls = named(["waterfall"]), lakes = named(["lake"]), peaks = named(["peak"]);
  if (falls.length) parts.push(falls.slice(0, 1).join(""));
  else if (n(["waterfall"])) parts.push(count(n(["waterfall"]), "waterfall", "waterfalls"));
  if (lakes.length) parts.push(list(lakes.slice(0, 2)));
  else if (n(["lake"])) parts.push(count(n(["lake"]), "lake", "lakes"));
  if (peaks.length && parts.length < 2) parts.push(peaks[0]);
  const views = n(["viewpoint"]);
  if (views) parts.push(count(views, "viewpoint", "viewpoints"));
  const camps = n(["campsite", "camp_pitch"]), huts = n(["shelter", "hut"]);
  if (camps) parts.push(count(camps, "mapped campsite", "mapped campsites"));
  else if (huts) parts.push(count(huts, "shelter", "shelters"));
  const water = n(["spring", "drinking_water"]);
  if (water && parts.length < 4) parts.push(water === 1 ? "a water source" : `${water < 10 ? NUMBER[water] : water} water sources`);
  else if (!water && n(["river", "crossing", "ford"]) && parts.length < 4) parts.push("creek crossings");
  return parts.length ? list(parts.slice(0, 4)) : null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "Jul-Sep" → "July to September"; other recorded seasons are kept as written. */
function seasonText(season: string) {
  const m = /^([A-Z][a-z]{2})-([A-Z][a-z]{2})$/.exec(season.trim());
  const name = (abbr: string) => MONTHS.find((x) => x.startsWith(abbr));
  if (m && name(m[1]) && name(m[2])) return `from ${name(m[1])} to ${name(m[2])}`;
  return null;
}
/**
 * Typical season: the source's season when it gives months, otherwise estimated from the high point and latitude
 * (snow lingers on high ground; low deserts are too hot in summer). Always worded as typical, never as a rule.
 */
export function typicalSeason(t: Pick<CatalogTrail, "season" | "maxElevFt" | "latitude" | "region" | "country">): string | null {
  const recorded = t.season ? seasonText(t.season) : null;
  if (recorded) return `usually open ${recorded}`;
  const high = t.maxElevFt;
  if (!Number.isFinite(high)) return null;
  const lat = Math.abs(t.latitude);
  const south = t.latitude < 0;
  const months = (a: number, b: number) => `${MONTHS[(a + (south ? 6 : 0)) % 12]} to ${MONTHS[(b + (south ? 6 : 0)) % 12]}`;
  // Snow line falls roughly 330 ft per degree of latitude: ~11,000 ft at 32°, ~6,000 ft at 47°.
  const snowLine = 11000 - (lat - 32) * 330;
  if (high! >= snowLine) return `typically snow-free from about ${months(6, 9)}`;
  if (high! >= snowLine - 2500) return `best from about ${months(4, 10)}, once the snow melts`;
  const desert = /^(Arizona|Nevada|New Mexico|Utah)$/.test(t.region ?? "") || (t.region === "California" && t.latitude < 35.5 && high! < 3000) || (t.region === "Texas" && t.latitude < 31.5);
  if (desert && high! < 5000) return `best from ${months(9, 3)}, outside the summer heat`;
  if (lat >= 45) return `typically hiked from ${months(4, 9)}`;
  if (lat < 35) return "hikeable most of the year";
  return null;
}

const SHAPE_NOUN: Record<string, string> = { loop: "loop", "out-and-back": "out-and-back hike", "point-to-point": "point-to-point hike", segment: "trail", network: "trail" };

/**
 * A 2–3 sentence description written from the trail's real data: what and where (length, route type, place,
 * difficulty), the shape of the climb with its high point and what it passes, and who manages it with the typical
 * season. Sentence patterns vary by trail (seeded by id) so neighbouring trails don't read the same.
 */
export function describeTrailParts(t: CatalogTrail, { difficulty, time, units, features = [], profile = null }: { difficulty: TrailDifficulty; time?: string | null; units?: Units; features?: { type: FeatureType; name?: string | null }[]; profile?: [number, number][] | null }): DescriptionPart[] {
  const r = seed(t.id);
  const name = baseName(t.name);
  const where = t.park ?? t.forest ?? (t.blmArea && !/^blm\s+[a-z]{2}$/i.test(t.blmArea) ? t.blmArea : null);
  const place = [where, t.region ?? countryName(t.country)].filter(Boolean).join(", ");
  const length = formatDistance(t.miles, units);
  const noun = SHAPE_NOUN[t.routeType ?? ""] ?? "trail";
  const level = (DIFFICULTY_LABELS[difficulty] ?? difficulty).toLowerCase();
  const sized = length ? `${length} ${noun}` : noun;
  const timed = time ? `${/^\d/.test(time) ? "about " : ""}${time}` : null;

  // 1. What and where.
  const leads = [
    `${name} is ${an(sized)} ${sized}${place ? ` in ${place}` : ""}, rated ${level}${timed ? ` and usually ${timed} on foot` : ""}.`,
    `${place ? `In ${place}, ` : ""}${name} makes ${an(level)} ${level} ${sized}${timed ? ` of ${timed}` : ""}.`,
    `Rated ${level}, ${name} covers ${length ?? "its route"}${noun === "trail" ? "" : ` as ${an(noun)} ${noun}`}${place ? ` in ${place}` : ""}${timed ? `; plan on ${timed}` : ""}.`,
    ...(timed ? [`${capital(an(level))} ${level} ${sized}${place ? ` in ${place}` : ""}, ${name} takes ${timed} for most hikers.`] : []),
  ];
  const out: DescriptionPart[] = [pick(leads, r)];

  // 2. Shape of the climb, high point and what it passes.
  const shape = profileShape(profile, t);
  const gain = formatElevation(t.gainFt, units);
  const peakFt = profile?.length ? Math.max(...profile.map((p) => p[1])) : t.maxElevFt;
  const high = Number.isFinite(peakFt) ? formatElevation(Math.round(peakFt! / 10) * 10, units) : null;
  const loop = t.routeType === "loop", back = t.routeType === "out-and-back";
  const terrain: Record<ProfileShape, string[]> = {
    flat: [`It stays nearly level the whole way${high ? ` at around ${high}` : ""}`, `Expect easy, nearly flat walking${gain ? ` with only ${gain} of climbing` : ""}`],
    "steady-climb": [
      `It's one steady climb${gain ? ` of about ${gain}` : ""}${high ? ` to a high point of ${high}` : ""}${back ? ", so the return is all downhill" : loop ? ", then the loop drops back to the start" : ""}`,
      `The climb is sustained rather than steep in bursts${gain ? `, about ${gain} in all` : ""}${high ? `, topping out at ${high}` : ""}`,
      `Expect to gain${gain ? ` about ${gain}` : " elevation"} steadily from one end${high ? ` to the ${high} high point` : ""} at the other`,
    ],
    summit: [
      `The trail climbs${gain ? ` about ${gain}` : ""} to its high point${high ? ` of ${high}` : ""} partway along${loop ? " before looping back down" : ", then descends"}`,
      `Most of the effort comes on the way to a high point${high ? ` of ${high}` : ""} midway${gain ? `, with about ${gain} of climbing` : ""}`,
    ],
    ridge: [
      `After the initial climb it stays high along a ridge${high ? `, peaking at ${high}` : ""}${back ? ", then retraces the same line" : ""}`,
      `Much of the route holds close to its high point${high ? ` of ${high}` : ""} along a ridge${gain ? `, with about ${gain} of climbing` : ""}`,
    ],
    rolling: [
      `The terrain rolls up and down${gain ? `, adding up to about ${gain} of climbing` : ""}${high ? ` with a high point of ${high}` : ""}`,
      `Expect repeated short climbs and descents${gain ? ` totalling about ${gain}` : ""}${high ? `, the highest at ${high}` : ""}`,
    ],
    gentle: [`It climbs ${gain ? `about ${gain}` : "gradually"} in all${high ? `, with a high point of ${high}` : ""}`, `The route climbs${gain ? ` about ${gain}` : ""}${high ? `, reaching ${high} at its highest` : ""}`],
  };
  const passes = featurePhrase(features);
  const climb = shape ? pick(terrain[shape], r >>> 3) : high ? `It reaches ${high} at its highest` : null;
  if (climb && passes) out.push(` ${climb}, passing ${passes}.`);
  else if (climb) out.push(` ${climb}.`);
  else if (passes) out.push(` Along the way it passes ${passes}.`);

  // 3. Who manages it (linked to their official page) and the typical season.
  const manager = landManager(t);
  const season = typicalSeason(t);
  if (manager) {
    const link: DescriptionPart = manager.url ? { text: manager.name, href: manager.url } : manager.name;
    // "the U.S. Forest Service", "the California Coastal Commission"; "Angeles National Forest" as is.
    const the = /^(U\.S\.|United States|National Park Service|City of|Town of|Region of)|\b(Service|Bureau|Commission|Department|Agency|Association|Conservancy)\b/.test(manager.name) && !/^the\b/i.test(manager.name) ? "the " : "";
    const variants: DescriptionPart[][] = [
      [` Check current conditions with ${the}`, link, season ? `; the trail is ${season}.` : " before you go."],
      [season ? ` It's ${season}; ` : " ", season ? `confirm closures with ${the}` : `Confirm closures and conditions with ${the}`, link, "."],
    ];
    out.push(...pick(variants, r >>> 5));
  } else if (season) {
    out.push(` The trail is ${season}.`);
  }
  return out;
}

/** The description as plain text (for search snippets, meta descriptions and tests). */
export function describeTrail(t: CatalogTrail, options: Parameters<typeof describeTrailParts>[1]): string {
  return describeTrailParts(t, options).map((p) => (typeof p === "string" ? p : p.text)).join("").trim();
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
