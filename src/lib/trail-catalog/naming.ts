/**
 * Display names for incomplete source names. Many OpenStreetMap names are a single word ("Burton"), leave out the
 * kind of way ("Eagle Rock") or are really the name of a place ("Griffith Park"). Those get a fuller name built
 * from the trail's own context: "Burton Trail — Angeles National Forest". The source's name is kept in
 * `originalName` so the trail page can show it under "About this data".
 *
 * Curated guides, through-hikes, peaks, resort trails, Wikipedia-matched trails and placeholder names are left alone.
 */
import type { CatalogTrail } from "./types";
import { countryName } from "./types";
import { NOT_A_TRAIL_NAME } from "./search";

/** Words (in many languages) that already say "this is a trail". */
const TRAIL_WORD = /\b(trails?|path(way)?s?|loops?|routes?|tracks?|way|walk(way)?s?|greenway|trailway|trace|byway|towpath|boardwalk|promenade|footpath|bridle ?path|bikeway|cut-?off|connector|circuit|traverse|steps|stairs|tr|lp|rail ?trail|highline|portage|sentier|sentiero|chemin|camino|senda|sendero|ruta|rota|trilha|via|weg|pfad|steig|leden|stien|polku|reitti|traject|wandelroute|tour|run|rundweg|runde|road|rd|motorway|fire ?road|truck|jeep|lane|drive|parkway|crossover)\b/i;
/** Compound words that end in a trail word: "Höhenweg", "Kungsleden", "Panoramasteig". */
const TRAIL_SUFFIX = /(weg|wege|pfad|steig|leden|stien|stigen|polku|reitti|sentiero|route)$/i;
/** Names that describe a place rather than a trail. */
const PLACE_WORD = /\b(park|parks|forest|preserve|reserve|reservation|county|state|national|wilderness|recreation area|open space|conservation area|refuge|campground|natural area|nature center|nature preserve|monument|sanctuary|estate|arboretum|garden|gardens|common|commons|green|cemetery|campus|university|college|school|golf course|neighborhood|subdivision|village|town|city)\b/i;
/** Countries where trails are named in English, so "Trail" is the natural word to add. */
const ENGLISH = new Set(["US", "CA", "GB", "IE", "AU", "NZ", "ZA"]);
/** Data publishers that sources list as the "manager" but don't manage land ("New Hampshire GRANIT", "MassGIS"). */
export const GIS_PUBLISHER = /\b(gis|granit|geographic|agrc|technical center|mapping|data ?hub)\b|^state of /i;
/** Agencies too generic to be the context of a name ("Burton Trail — U.S. Forest Service" adds little). */
const GENERIC_MANAGER = /^(u\.?s\.? forest service|usfs|national park service|nps|bureau of land management|blm|private|public|unknown|city|county|state)$/i;
/** Sources whose names are already curated. */
const CURATED = new Set<CatalogTrail["source"]>(["guide", "route-aggregate", "peak", "resort"]);

const norm = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Source clutter removed from every name: agency record numbers ("16006: West Kern River"), USGS map-quad suffixes
 * ("… Usgs Lake Isabella North"), "Unk1" placeholders; trailing "Tr"/"Lp" spelled out ("Burton Tr" → "Burton Trail").
 */
export function tidyTrailName(name: string) {
  const out = name
    .replace(/^\d{3,}\s*[:.-]?\s+(?=\p{L})/u, "")
    .replace(/^\d{1,3}\s*[-–]\s+(?=\p{L})/u, "")
    .replace(/\s+usgs\b.*$/i, "")
    .replace(/\s*\bunk\d*\b/gi, "")
    .replace(/\bNrt$/i, "National Recreation Trail").replace(/\bNst$/i, "National Scenic Trail")
    .replace(/\bTr\.?$/i, "Trail").replace(/\bTrl\.?$/i, "Trail").replace(/\bLp\.?$/i, "Loop").replace(/\bPth\.?$/i, "Path")
    .replace(/\s{2,}/g, " ")
    .trim();
  return /\p{L}/u.test(out) ? out : name.trim();
}

export const hasTrailWord = (name: string) => TRAIL_WORD.test(name) || name.split(/\s+/).some((w) => TRAIL_SUFFIX.test(w));

type NameContext = Pick<CatalogTrail, "id" | "name" | "country" | "region" | "kind" | "source" | "park" | "forest" | "blmArea" | "skiResort" | "manager" | "wiki" | "peakCategory" | "partOfRoute" | "originalName"> & Partial<Pick<CatalogTrail, "routeType">>;

/**
 * A name for a trail the source left unnamed, from what the data says about it: its shape and where it is
 * ("Loop in Griffith Park", "Trail in Angeles National Forest", "Paths in Riverside Park"). Never invents a name
 * the trail doesn't have on the ground; the trail page still shows the source called it unnamed.
 */
export function describedName(t: NameContext): string | null {
  const manager = t.manager && !GENERIC_MANAGER.test(t.manager.trim()) && !GIS_PUBLISHER.test(t.manager) ? t.manager.trim() : null;
  const blm = t.blmArea && !/^blm\s+[a-z]{2}$/i.test(t.blmArea.trim()) ? t.blmArea.trim() : null;
  // Some sources put the place inside the placeholder: "Unnamed (Pedlar Wma) 2".
  const inName = /^unnamed\b[^(]*\(([^)]+)\)/i.exec(t.name)?.[1]?.trim().replace(/\bWma\b/g, "WMA").replace(/\bSp\b/g, "State Park");
  const place = t.park?.trim() || t.forest?.trim() || blm || t.skiResort?.trim() || (inName && /\p{L}/u.test(inName) ? inName : null) || manager || t.region?.trim() || (t.country ? countryName(t.country) : null);
  if (!place) return null;
  const kind = t.routeType === "loop" ? "Loop" : t.routeType === "network" ? "Paths" : ENGLISH.has(t.country) ? "Trail" : "Path";
  return `${kind} in ${place}`;
}

/** Where the trail is, for a name suffix: its park, forest, BLM area or resort, else its state or country. */
function contextOf(t: NameContext, name: string): string | null {
  const n = norm(name);
  const manager = t.manager && !GENERIC_MANAGER.test(t.manager.trim()) && !GIS_PUBLISHER.test(t.manager) ? t.manager : null;
  // "BLM CA" (an office code, not a place) is skipped.
  const blm = t.blmArea && !/^blm\s+[a-z]{2}$/i.test(t.blmArea.trim()) ? t.blmArea : null;
  const candidates = [t.park, t.forest, blm, t.skiResort, manager, t.region, t.country ? countryName(t.country) : null];
  for (const c of candidates) {
    if (!c?.trim()) continue;
    const k = norm(c);
    // Skip a context the name already says ("Griffith Park" in Griffith Park).
    if (!k || n.includes(k) || k.includes(n)) continue;
    return c.trim();
  }
  return null;
}

/** Why a name needs work, or null when it reads as a trail name already. */
export function nameProblem(t: NameContext): "single-word" | "no-trail-word" | "place-name" | null {
  const name = t.name.trim();
  if (!name || /^unnamed/i.test(name) || NOT_A_TRAIL_NAME.test(name)) return null;
  if (t.kind === "route" || CURATED.has(t.source) || t.peakCategory || t.partOfRoute || t.wiki?.title) return null;
  const words = name.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  const k = norm(name);
  const places = [t.park, t.forest, t.blmArea, t.skiResort, t.region].filter(Boolean).map((p) => norm(p!));
  if (places.some((p) => p === k) || (PLACE_WORD.test(name) && !hasTrailWord(name))) return "place-name";
  if (words.length <= 1) return "single-word";
  if (!hasTrailWord(name)) return "no-trail-word";
  return null;
}

/**
 * The name to show for a trail. "Burton" in Angeles National Forest → "Burton Trail — Angeles National Forest";
 * "Eagle Rock" → "Eagle Rock Trail — Topanga State Park"; complete names are returned unchanged.
 */
export function displayTrailName(t: NameContext): string {
  const raw = t.name.trim();
  if (!raw || /^unnamed/i.test(raw)) return describedName(t) ?? raw;
  if (NOT_A_TRAIL_NAME.test(raw)) return raw;
  const tidy = tidyTrailName(raw);
  // A Wikipedia-matched trail takes its article title when that is the fuller name ("Wonderland" → "Wonderland Trail").
  const title = t.wiki?.title?.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (title && title !== tidy && norm(title).includes(norm(tidy)) && hasTrailWord(title) && !hasTrailWord(tidy)) return title;
  const problem = nameProblem({ ...t, name: tidy });
  if (!problem) return tidy;
  const words = tidy.split(/\s+/).length;
  // "Trail" is added to short English names only; a long descriptive name ("Beach from X to Y") reads better without.
  const english = ENGLISH.has(t.country) && /^[\p{Script=Latin}\d\s'’.&,-]+$/u.test(tidy);
  const descriptive = words > 4 || /\s(to|from|-|–)\s/i.test(tidy);
  const base = english && !descriptive && !hasTrailWord(tidy) ? `${tidy} Trail` : tidy;
  const context = base.length <= 48 ? contextOf(t, tidy) : null;
  return context ? `${base} — ${context}` : base;
}

/** A trail with its display name; the source's name is kept in originalName when it changed. */
export function withDisplayName<T extends NameContext>(t: T): T {
  const name = displayTrailName(t);
  return name === t.name ? t : { ...t, name, originalName: t.originalName ?? t.name };
}

/** The name without its place suffix ("Burton Trail"), for cards whose location line already says where. */
export const shortTrailName = (name: string) => name.split(" — ")[0];
