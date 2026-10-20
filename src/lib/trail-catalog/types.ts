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
  difficulty: string | null;
  dogs: boolean | null;
  source: "usgs" | "parks-canada" | "ontario" | "nps" | "usfs" | "blm" | "resort" | "guide" | "route-aggregate";
  sourceId: string;
  sourceUrl: string;
  officialUrl: string | null;
  sourceDate: string | null;
  manager: string | null;
  surface: string | null;
  season: string | null;
  geometryShard: string;
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
  difficulty?: string;
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
};

export const countryName = (country: string) => COUNTRY_NAMES[country] ?? country;

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
};

export const sourceName = (source: CatalogTrail["source"]) => SOURCE_NAMES[source] ?? source;

/** Where a trail is, for list rows: its park, forest, BLM area or resort, else the managing agency. */
export function trailPlace(t: Pick<CatalogTrail, "park" | "forest" | "blmArea" | "skiResort" | "sourceType" | "source">) {
  if (t.park ?? t.forest ?? t.skiResort) return (t.park ?? t.forest ?? t.skiResort)!;
  const agency: Partial<Record<NonNullable<CatalogTrail["sourceType"]>, string>> = { NPS_OFFICIAL: "National Park Service", USFS_OFFICIAL: "U.S. Forest Service", BLM_OFFICIAL: t.blmArea ?? "Bureau of Land Management" };
  return (t.sourceType && agency[t.sourceType]) ?? sourceName(t.source);
}

/** Short trails show meters instead of a misleading "<0.1 mi". */
export function displayMiles(miles: number | null) {
  if (miles === null) return "Distance unknown";
  if (miles < 0.1) return `${Math.round((miles * 1609.344) / 5) * 5} m`;
  return miles >= 100 ? `${Math.round(miles).toLocaleString("en-US")} mi` : `${miles.toFixed(1)} mi`;
}
