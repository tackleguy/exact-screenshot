import { formatDistance } from "@/lib/units";
export interface CatalogTrail {
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2 country code (US, CA, FR, …). */
  country: string;
  region: string | null;
  kind: "segment" | "route";
  miles: number | null;
  distanceBasis: "source" | "geometry";
  latitude: number;
  longitude: number;
  /** Difficulty from computeDifficulty (src/lib/trail-difficulty.ts), stored by the data build. */
  difficulty: string | null;
  /** The source's own difficulty wording, when it gave one (kept for reference; not used for the rating). */
  reportedDifficulty?: string | null;
  /** Measured along the line from elevation data by the data build: climb (larger direction for a line), descent, range, steepest 100 m grade. */
  gainFt?: number | null;
  lossFt?: number | null;
  minElevFt?: number | null;
  maxElevFt?: number | null;
  steepestGradePct?: number | null;
  dogs: boolean | null;
  source: "usgs" | "parks-canada" | "ontario" | "nps" | "usfs" | "blm" | "resort" | "guide" | "route-aggregate" | "peak" | "osm";
  sourceId: string;
  sourceUrl: string;
  officialUrl: string | null;
  sourceDate: string | null;
  manager: string | null;
  surface: string | null;
  season: string | null;
  geometryShard: string;
  /** Extent of the mapped line [west, south, east, north], added when the app's files are built, so a map view
   * finds every trail that passes through it, not only those whose pin is in view. */
  bounds?: [number, number, number, number];
  /** Source sections merged into this trail (or aggregated into a through-hike route). */
  sectionCount?: number;
  /** Through-hike route metadata (optional). */
  mappedMiles?: number;
  /** Catalog trails whose geometry makes up a through-hike route. */
  memberIds?: string[];
  note?: string;
  tags?: string[];
  /** Automated quality status (src/lib/trail-catalog/quality.ts). Missing on routes and older snapshots. */
  quality?: import("./quality").QualityStatus;
  flags?: import("./quality").QualityFlag[];
  routeType?: import("./quality").RouteType;
  /** Longer same-name trail this record appears to be a disconnected piece of. */
  parentId?: string;
  /** Source-reported length, kept when it disagrees with the mapped line. */
  reportedMiles?: number;
  /** Set when the mapped line follows OpenSkiMap pistes: downhill runs are not hiking trails. */
  winterUse?: import("./ski-runs").WinterUse;
  /** Nearest OpenStreetMap trailhead to either end of the trail, when one is mapped within 800 m. */
  trailhead?: import("./access").AccessPoint;
  /** Elevation range sampled along the line (Copernicus DEM via Open-Meteo), in feet; set for NPS additions. */
  elevationFt?: { min: number; max: number };
  /** Ski area the matching piste belongs to (OpenSkiMap). */
  skiArea?: string;
  /** Kind of evidence behind the record (see agencies.ts). */
  sourceType?: import("./agencies").SourceType;
  confidence?: import("./agencies").Confidence;
  trailType?: import("./agencies").TrailType;
  trailStatus?: import("./agencies").TrailStatus;
  /** Other official datasets that map the same line (NPS, USFS, BLM). */
  sources?: import("./agencies").SourceRef[];
  /** Agency trail number, e.g. USFS "610". */
  officialTrailId?: string;
  park?: string;
  forest?: string;
  blmArea?: string;
  /** Ski resort whose official summer trail information lists this trail. */
  skiResort?: string;
  /** Officially allowed uses (USFS). */
  uses?: string[];
  /** Source name when it was a placeholder ("-", "<unnamed>") and is shown as Unnamed trail. */
  originalName?: string;
  /** Mountain peak category when this record is a prominent summit. */
  peakCategory?: "14er" | "8000m" | "seven-summits";
  /** Summit elevation in feet above sea level. */
  summitElevationFt?: number;
  /** Summit elevation in meters above sea level. */
  summitElevationM?: number;
  /** When this trail is a through-hike, the ordered list of constituent sections/segments. */
  sections?: { id: string; name: string; miles: number; difficulty?: string | null; elevationFt?: number | null }[];
  /** When this trail is a section/segment, the parent through-hike route it belongs to. */
  partOfRoute?: { id: string; name: string; totalMiles: number };
  /** OpenStreetMap route relation this trail is (or was merged with). */
  osm?: OsmRouteInfo;
  /** Named OpenStreetMap ways joined into this trail (same name, connected within 25 m). */
  osmWay?: { ids: number[]; highway: string; sacScale?: string; mtbScale?: string; pisteType?: string };
  /**
   * verified: an official agency record or an OpenStreetMap route relation.
   * mapped: named OpenStreetMap ways that passed every verification rule. Nothing below "mapped" is shown.
   */
  tier?: "verified" | "mapped";
  /** Other names: OSM alt/official/short names and Wikidata aliases. */
  altNames?: string[];
  /** Matched Wikidata item, with the Wikipedia lead paragraph and main Commons image when they exist. */
  wiki?: WikiInfo;
  /** Set on an official record whose line is now part of a merged trail; links redirect there. */
  mergedInto?: string;
  /** For a curated guide (peak, through-hike, section): the catalog trail whose real line it shows. */
  linkedTrailId?: string;
  /** Ranking signal (see src/lib/trail-catalog/score.ts); higher is a more complete, better-sourced trail. */
  qualityScore?: number;
  /** Where each derived fact came from, e.g. { miles: "OpenStreetMap geometry", difficulty: "Hyked formula: …" }. */
  factSources?: Record<string, string>;
}
export interface OsmRouteInfo {
  relation: number;
  /** route tag: hiking, foot, walking, running, fitness_trail, bicycle, mtb, horse, ski, piste, canoe or inline_skates. */
  route: string;
  /** piste:type of a piste route (nordic, downhill, skitour, sled, hike, …). */
  pisteType?: string;
  network?: string;
  ref?: string;
  symbol?: string;
  description?: string;
  /** distance tag as mapped (km unless a unit is given). */
  distance?: string;
  sacScale?: string;
  website?: string;
}
export interface WikiInfo {
  qid: string;
  title?: string;
  url?: string;
  extract?: string;
  image?: { url: string; pageUrl: string; license: string | null; licenseUrl: string | null; artist: string | null };
}
export interface CatalogManifest {
  version: number;
  generatedAt: string;
  total: number;
  /** Source sections merged into the `total` trails. */
  sectionTotal?: number;
  countries: Record<string, number>;
  sources: { key?: string; name: string; url: string; license: string; count: number; query: string; retrievedAt: string }[];
  regions: { name: string; country: string; count: number }[];
  indexSha256: string;
  excluded: Record<string, number>;
  notes: string[];
  /** Per-agency discovery and import counts from the last scan. */
  coverage?: Record<string, { areasDiscovered: number; areasProcessed: number; linesDiscovered: number; newLinesImported: number; trailsAdded: number; existingTrailsConfirmed: number; needsReview: number; rejected: number; lastScan: string }>;
  confidence?: Record<string, number>;
  /** Trails shown publicly (excludes rejected records); set at load time. */
  publicTotal?: number;
  /** Shown trails by confidence tier (catalog v3). The site's headline count is verified + mapped. */
  tiers?: { verified: number; mapped: number };
}
export type CatalogBounds = [west: number, south: number, east: number, north: number];
export interface CatalogMapPoint {
  id: string;
  longitude: number;
  latitude: number;
  count: number;
  bounds?: CatalogBounds;
  trail?: CatalogTrail;
}
export interface CatalogMapResult {
  points: CatalogMapPoint[];
  total: number;
  bounds: CatalogBounds | null;
  grouped: boolean;
}
export type { CatalogActivity } from "./activity";

export interface CatalogFilters {
  bbox?: CatalogBounds;
  q?: string;
  country?: string;
  region?: string;
  page?: number;
  limit?: number;
  minMiles?: number;
  maxMiles?: number;
  /** One or more of easy, moderate, hard, expert (comma separated): reported, else estimated. */
  difficulty?: string;
  routeType?: import("./quality").RouteType;
  dogFriendly?: boolean;
  /** When true, keep ski/snowshoe/snowmobile-named sections. Default excludes them. */
  includeWinter?: boolean;
  /** Hiking / backpacking / biking / trail running / ski. Defaults to hiking. Use "all" to skip activity filtering. */
  activity?: import("./activity").CatalogActivityFilter;
  /** segment = mapped sections; route = through-hikes / curated guides. */
  kind?: "segment" | "route";
  /** Collapse same-name sections to the longest one (routes always kept). */
  uniqueNames?: boolean;
  /** Include fragments (pieces of longer trails, unnamed stubs, connectors). Default excludes them. */
  includeFragments?: boolean;
  /** Only trails a given ski resort lists (e.g. "Vail"). */
  resort?: string;
  sourceType?: import("./agencies").SourceType;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  targetMiles?: number;
  /** Special collections: 14ers, 8000m, 7summits, thru-hikes, thru-sections */
  collection?: string;
  peakCategory?: "14er" | "8000m" | "seven-summits";
  thruHikeSections?: boolean;
  /** Only trails an official agency or guide confirms (tier "verified"). */
  verified?: boolean;
  /** List order: best (default), shortest or longest first. */
  sort?: "best" | "short" | "long";
}

const COUNTRY_NAMES: Record<string, string> = {
  US: "United States",
  CA: "Canada",
  FR: "France",
  IT: "Italy",
  CH: "Switzerland",
  SE: "Sweden",
  CL: "Chile",
  IS: "Iceland",
  NP: "Nepal",
  PE: "Peru",
  NZ: "New Zealand",
  AU: "Australia",
  TZ: "Tanzania",
  ES: "Spain",
  GR: "Greece",
  TR: "Turkey",
  BT: "Bhutan",
  ZA: "South Africa",
  AR: "Argentina",
  RU: "Russia",
  ID: "Indonesia",
  PK: "Pakistan",
  CN: "China",
  AQ: "Antarctica",
};

let regionNames: Intl.DisplayNames | null | undefined;
/** English name of an ISO 3166-1 alpha-2 country code (the catalog spans every country with mapped trails). */
export const countryName = (country: string) => {
  if (COUNTRY_NAMES[country]) return COUNTRY_NAMES[country];
  if (regionNames === undefined) {
    try { regionNames = new Intl.DisplayNames(["en"], { type: "region" }); } catch { regionNames = null; }
  }
  if (!regionNames || !/^[A-Z]{2}$/.test(country)) return country;
  try { return regionNames.of(country) ?? country; } catch { return country; }
};

const SOURCE_NAMES: Record<CatalogTrail["source"], string> = {
  usgs: "USGS",
  "parks-canada": "Parks Canada",
  ontario: "Ontario Trail Network",
  nps: "National Park Service",
  usfs: "U.S. Forest Service",
  blm: "Bureau of Land Management",
  resort: "Resort summer trail map",
  guide: "Curated guide",
  "route-aggregate": "Mapped corridor",
  peak: "Mountain Summit Guide",
  osm: "Mapped route",
};

export const sourceName = (source: CatalogTrail["source"]) => SOURCE_NAMES[source] ?? source;

/** Where a trail is, for list rows: its park, forest, BLM area or resort, else the managing agency. */
export function trailPlace(t: Pick<CatalogTrail, "park" | "forest" | "blmArea" | "skiResort" | "sourceType" | "source">) {
  if (t.park ?? t.forest ?? t.skiResort) return (t.park ?? t.forest ?? t.skiResort)!;
  const agency: Partial<Record<NonNullable<CatalogTrail["sourceType"]>, string>> = { NPS_OFFICIAL: "National Park Service", USFS_OFFICIAL: "U.S. Forest Service", BLM_OFFICIAL: t.blmArea ?? "Bureau of Land Management" };
  return (t.sourceType && agency[t.sourceType]) ?? sourceName(t.source);
}

/** A trail's length in the visitor's units (short trails in feet or metres, never "<0.1 mi"). */
export function displayMiles(miles: number | null) {
  return formatDistance(miles) ?? "Distance unknown";
}

/** OSM sac_scale for a trail, from its route relation or its joined ways. */
export const trailSacScale = (t: Pick<CatalogTrail, "osm" | "osmWay">) => t.osm?.sacScale ?? t.osmWay?.sacScale ?? null;

/** The headline trail count: verified + mapped (exact, never rounded up); older snapshots fall back to publicTotal. */
export const headlineCount = (m: Pick<CatalogManifest, "tiers" | "publicTotal" | "total">) => (m.tiers ? m.tiers.verified + m.tiers.mapped : m.publicTotal ?? m.total);
