import type { CatalogTrail } from "./types";
import { isWinterActivityTrail } from "./winter";

/**
 * Trail sections. Official allowed uses (USGS, USFS, BLM) decide bike and horse access when they are
 * known; names and surfaces fill in the rest. "bike" is every bikeable trail (mountain + path).
 */
export type CatalogActivity = "hike" | "walk" | "backpack" | "run" | "bike" | "mtb" | "path-bike" | "horse" | "ski";
/** Internal / explicit “no activity filter” for winter-inclusive browse. */
export type CatalogActivityFilter = CatalogActivity | "all";

export const CATALOG_ACTIVITIES: readonly CatalogActivity[] = [
  "hike",
  "walk",
  "backpack",
  "run",
  "bike",
  "mtb",
  "path-bike",
  "horse",
  "ski",
] as const;

export const CATALOG_ACTIVITY_LABELS: Record<CatalogActivity, string> = {
  hike: "Hiking",
  walk: "Walking",
  backpack: "Backpacking",
  run: "Trail running",
  bike: "Biking",
  mtb: "Mountain biking",
  "path-bike": "Road & path biking",
  horse: "Horseback riding",
  ski: "Ski & snow",
};

const BIKE =
  /\b(bike|biking|bicycl(?:e|ing)|cycling|cyclist|mtb|mountain[\s-]?bike|rail[\s-]?trail|greenway|bike[\s-]?path|bike[\s-]?way)\b/i;
const RUN =
  /\b(trail[\s-]?run(?:ning)?|running|runner|jog(?:ging)?|footing)\b/i;
const BACKPACK =
  /\b(backpack(?:ing)?|thru[\s-]?hike|through[\s-]?hike|long[\s-]?distance|overnight|multi[\s-]?day|wilderness)\b/i;
const SKI =
  /\b(ski(?:ing)?|skier|nordic|cross[\s-]?country|\bx-?c\b|groomed\s+ski|ski\s+trail|ski\s+loop)\b/i;
const SNOWMOBILE = /\b(snow[\s-]?mobile|snowmobile|snowmobiling)\b/i;
/** Bike-primary names that are usually not advertised as hiking. */
const BIKE_PRIMARY =
  /\b(mountain[\s-]?bike|\bmtb\b|bike[\s-]?only|cycling|bicycle)\b/i;

type ActivityFields = Pick<CatalogTrail, "name" | "manager" | "tags" | "surface" | "kind" | "miles"> & Partial<Pick<CatalogTrail, "winterUse" | "flags" | "source" | "uses" | "osm">>;

/** Sections an OSM route relation belongs to, from its route tag; null for foot routes (classified as trails). */
function osmRouteActivities(trail: ActivityFields): CatalogActivity[] | null {
  switch (trail.osm?.route) {
    case "bicycle": return ["bike", "path-bike"];
    case "mtb": return ["bike", "mtb"];
    case "horse": return ["horse"];
    case "ski": return ["ski"];
    default: return null;
  }
}

const PAVED = /\b(paved|asphalt|concrete|boardwalk|brick|bituminous|pavement)\b/i;
const GRAVEL = /\b(gravel|crushed|aggregate|stone ?dust|cinder|limestone)\b/i;
const PATH_BIKE = /\b(rail[\s-]?trail|greenway|bike[\s-]?(path|way|route|lane)|bikeway|cycleway|multi[\s-]?use path|towpath|canal path|parkway trail)\b/i;
const WALK = /\b(walk(?:way)?|boardwalk|promenade|riverwalk|river walk|greenway|nature (trail|path|loop)|interpretive|accessible|ada|self[\s-]?guided|arboretum|garden|stroll|loop walk|paseo)\b/i;
const HORSE = /\b(equestrian|horse|bridle|saddle|pack ?and ?saddle)\b/i;
const usesInclude = (trail: Partial<Pick<CatalogTrail, "uses">>, use: RegExp) => Boolean(trail.uses?.some((u) => use.test(u)));

/** Paved or gravel paths (rail trails, greenways, bike paths) rather than singletrack. */
export function isPathSurface(trail: Pick<CatalogTrail, "name" | "surface"> & Partial<Pick<CatalogTrail, "flags">>) {
  if (trail.flags?.includes("sidewalk")) return true;
  if (trail.surface) return PAVED.test(trail.surface) || GRAVEL.test(trail.surface);
  return PATH_BIKE.test(trail.name);
}

function haystack(trail: Pick<CatalogTrail, "name" | "manager" | "tags" | "surface">) {
  return [trail.name, trail.manager ?? "", trail.surface ?? "", ...(trail.tags ?? [])].join(" ");
}

export function isBikeActivityTrail(trail: Pick<CatalogTrail, "name" | "manager" | "tags" | "surface"> & Partial<Pick<CatalogTrail, "uses">>) {
  return usesInclude(trail, /^(bikes|e-bikes)$/i) || BIKE.test(haystack(trail)) || PATH_BIKE.test(trail.name);
}

export function isHorseActivityTrail(trail: Pick<CatalogTrail, "name" | "manager" | "tags" | "surface"> & Partial<Pick<CatalogTrail, "uses">>) {
  return usesInclude(trail, /^horses$/i) || HORSE.test(trail.name);
}

/** Easy walks: paved or boardwalk paths, greenways and nature walks a few miles long. */
export function isWalkActivityTrail(trail: Pick<CatalogTrail, "name" | "surface" | "miles"> & Partial<Pick<CatalogTrail, "flags">>) {
  if (trail.miles !== null && trail.miles > 8) return false;
  if (trail.surface && PAVED.test(trail.surface)) return true;
  return WALK.test(trail.name) && !/\b(peak|summit|ridge|pass|canyon|wilderness)\b/i.test(trail.name);
}

export function isRunActivityTrail(trail: Pick<CatalogTrail, "name" | "manager" | "tags" | "surface">) {
  return RUN.test(haystack(trail));
}

export function isBackpackActivityTrail(
  trail: Pick<CatalogTrail, "name" | "manager" | "tags" | "surface" | "kind" | "miles">,
) {
  if (trail.kind === "route") return true;
  if (BACKPACK.test(haystack(trail))) return true;
  return trail.miles !== null && trail.miles >= 15;
}

export function isSkiActivityTrail(trail: Pick<CatalogTrail, "name" | "manager"> & Partial<Pick<CatalogTrail, "winterUse">>) {
  if (trail.winterUse) return true;
  if (!isWinterActivityTrail(trail)) return false;
  const text = `${trail.name} ${trail.manager ?? ""}`;
  if (SNOWMOBILE.test(text) && !SKI.test(text)) return false;
  return SKI.test(text) || isWinterActivityTrail(trail);
}

/** Activities a catalog row is suitable for (best-effort from name and length). */
export function trailActivities(trail: ActivityFields): CatalogActivity[] {
  const fromRoute = osmRouteActivities(trail);
  if (fromRoute) return fromRoute;
  const text = haystack(trail);
  const out: CatalogActivity[] = [];
  if (isSkiActivityTrail(trail)) out.push("ski");
  // Nordic tracks stay summer trails; downhill runs and over-snow routes are winter-only.
  const winter = isWinterActivityTrail(trail);
  // Road sidepaths and cycle tracks are paved bike routes even when the name doesn't say "bike".
  if (!winter && (isBikeActivityTrail(trail) || trail.flags?.includes("sidewalk"))) {
    out.push("bike", isPathSurface(trail) ? "path-bike" : "mtb");
  }
  if (!winter && isHorseActivityTrail(trail)) out.push("horse");
  if (isRunActivityTrail(trail)) out.push("run");
  if (isBackpackActivityTrail(trail)) out.push("backpack");
  // Hiking-first catalog: non-winter foot travel stays hikeable. Pure bike names stay bike-only,
  // unless the managing agency lists hiking as an allowed use.
  // An agency allowing bikes doesn't make a trail bike-only; only bike names do (hikers banned = "no-hiking" flag).
  const bikeByName = BIKE.test(text) || PATH_BIKE.test(trail.name);
  const multiUse =
    usesInclude(trail, /^hiking$/i) ||
    /\b(hike|hiking|foot|pedestrian|walk(?:ing)?|multi[\s-]?use)\b/i.test(text) ||
    (!bikeByName && !winter);
  const footOk = !winter && multiUse && (!BIKE_PRIMARY.test(text) || usesInclude(trail, /^hiking$/i));
  if (footOk) out.push("hike");
  if (footOk && trail.kind === "segment" && isWalkActivityTrail(trail)) out.push("walk");
  // Trail runners share most hiking paths when nothing is run-specific.
  if (out.includes("hike") && !out.includes("run") && trail.kind === "segment" && (trail.miles === null || trail.miles <= 20)) {
    out.push("run");
  }
  return out.length ? out : ["hike"];
}

export function matchesCatalogActivity(
  trail: ActivityFields,
  activity: CatalogActivity,
): boolean {
  return trailActivities(trail).includes(activity);
}

/** The few top-level sections people pick from (sign-up, map, search); each folds in its sub-sections. */
export const TRAIL_SECTIONS = [
  { key: "foot", label: "Hike & walk", activity: "hike", activities: ["hike", "walk", "backpack", "run"], blurb: "Hiking, walking, backpacking and trail running" },
  { key: "bike", label: "Bike", activity: "bike", activities: ["bike", "mtb", "path-bike"], blurb: "Mountain biking, rail trails and paved paths" },
  { key: "horse", label: "Horseback", activity: "horse", activities: ["horse"], blurb: "Trails open to horses and pack stock" },
  { key: "snow", label: "Snow", activity: "ski", activities: ["ski"], blurb: "Nordic ski, snowshoe, snowmobile and ski-area routes" },
] as const satisfies readonly { key: string; label: string; activity: CatalogActivity; activities: readonly CatalogActivity[]; blurb: string }[];
export type TrailSectionKey = (typeof TRAIL_SECTIONS)[number]["key"];
export const sectionOf = (activity: CatalogActivityFilter | undefined) =>
  TRAIL_SECTIONS.find((s) => (s.activities as readonly string[]).includes(activity ?? "hike")) ?? TRAIL_SECTIONS[0];
export const parseTrailSection = (value: unknown): TrailSectionKey | null =>
  TRAIL_SECTIONS.some((s) => s.key === value) ? (value as TrailSectionKey) : null;

export function parseCatalogActivity(value: string | null | undefined): CatalogActivityFilter | undefined {
  const raw = value?.trim().toLowerCase();
  if (raw === "all") return "all";
  return CATALOG_ACTIVITIES.includes(raw as CatalogActivity) ? (raw as CatalogActivity) : undefined;
}
