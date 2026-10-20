import type { CatalogTrail } from "./types";

/** Where a trail's evidence comes from. USGS_NTD is the federal compilation of agency trail data. */
export type SourceType =
  | "NPS_OFFICIAL"
  | "USFS_OFFICIAL"
  | "BLM_OFFICIAL"
  | "PARKS_CANADA_OFFICIAL"
  | "STATE_AGENCY"
  | "LOCAL_AGENCY"
  | "VERIFIED_ORGANIZATION"
  | "SKI_RESORT_OFFICIAL"
  | "USGS_NTD"
  | "CURATED_GUIDE";

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  NPS_OFFICIAL: "National Park Service",
  USFS_OFFICIAL: "U.S. Forest Service",
  BLM_OFFICIAL: "Bureau of Land Management",
  PARKS_CANADA_OFFICIAL: "Parks Canada",
  STATE_AGENCY: "State or provincial agency",
  LOCAL_AGENCY: "County or city agency",
  VERIFIED_ORGANIZATION: "Trail organization",
  SKI_RESORT_OFFICIAL: "Ski resort",
  USGS_NTD: "USGS National Digital Trails",
  CURATED_GUIDE: "Curated guide",
};

/**
 * - VERIFIED: an official source documents the trail and its geometry passes every check.
 * - OFFICIAL_GEOMETRY_VERIFIED: as VERIFIED, and a second official dataset maps the same line.
 * - NEEDS_REVIEW: looks legitimate but has conflicting length, gaps, no route line or other issues.
 * - REJECTED: not a hiking trail here (fragment, duplicate stub, road, sidewalk, ski run, motorized,
 *   hikers not allowed). Kept for links and review, never shown in trail results.
 */
export type Confidence = "VERIFIED" | "OFFICIAL_GEOMETRY_VERIFIED" | "NEEDS_REVIEW" | "REJECTED";
export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  VERIFIED: "Verified",
  OFFICIAL_GEOMETRY_VERIFIED: "Official — geometry verified",
  NEEDS_REVIEW: "Needs review",
  REJECTED: "Rejected",
};

export type TrailType = "hiking" | "nature" | "backpacking" | "accessible" | "boardwalk" | "scenic" | "multi-use" | "resort-hiking";
export const TRAIL_TYPE_LABELS: Record<TrailType, string> = {
  hiking: "Hiking trail",
  nature: "Nature trail",
  backpacking: "Backpacking route",
  accessible: "Accessible trail",
  boardwalk: "Boardwalk",
  scenic: "Scenic trail",
  "multi-use": "Multi-use trail",
  "resort-hiking": "Ski resort hiking",
};

export type TrailStatus = "OPEN" | "CLOSED" | "SEASONAL" | "RESTRICTED" | "UNKNOWN";

/** Another official dataset that maps the same line as this trail. */
export interface SourceRef {
  type: SourceType;
  /** Source record id (NPS GEOMETRYID, USFS TRAIL_CN, BLM GlobalID). */
  id: string;
  url: string;
  name: string;
  officialTrailId?: string;
  unit?: string;
}

/** The agency behind a USGS record, from its originator field. */
export function sourceTypeForManager(manager: string | null): SourceType {
  const m = (manager ?? "").toLowerCase();
  if (/forest service|usfs|national forest/.test(m)) return "USFS_OFFICIAL";
  if (/national park service|\bnps\b/.test(m)) return "NPS_OFFICIAL";
  if (/bureau of land management|\bblm\b/.test(m)) return "BLM_OFFICIAL";
  if (/parks canada/.test(m)) return "PARKS_CANADA_OFFICIAL";
  if (/\b(county|city|town|village|borough|township|municipal|metro|regional|district|parish)\b/.test(m)) return "LOCAL_AGENCY";
  if (/\b(state|department|dept|commonwealth|division|dnr|natural resources|parks and wildlife|conservation|environmental|fish and game|game commission|gis|agrc|granit|massgis|ontario)\b/.test(m)) return "STATE_AGENCY";
  if (/\b(association|conservancy|club|trust|society|foundation|alliance|council|university|college)\b/.test(m)) return "VERIFIED_ORGANIZATION";
  return "USGS_NTD";
}

export function sourceTypeFor(row: Pick<CatalogTrail, "source" | "manager">): SourceType {
  switch (row.source) {
    case "nps": return "NPS_OFFICIAL";
    case "usfs": return "USFS_OFFICIAL";
    case "blm": return "BLM_OFFICIAL";
    case "parks-canada": return "PARKS_CANADA_OFFICIAL";
    case "ontario": return /\b(county|city|town|municipal|region)\b/i.test(row.manager ?? "") ? "LOCAL_AGENCY" : "VERIFIED_ORGANIZATION";
    case "resort": return "SKI_RESORT_OFFICIAL";
    case "guide":
    case "route-aggregate": return "CURATED_GUIDE";
    default: return sourceTypeForManager(row.manager);
  }
}

/** USFS allowed_terra_use digits (confirmed against the *_managed fields): 1 hiker, 2 pack/saddle, 3 bicycle, 4 motorcycle, 5 ATV, 6 4WD. */
const USFS_USES: Record<string, string> = { "1": "Hiking", "2": "Horses", "3": "Bikes", "4": "Motorcycles", "5": "ATVs", "6": "4WD vehicles" };
export function usfsUses(code: unknown) {
  return typeof code === "string" ? [...new Set(code.split(""))].map((c) => USFS_USES[c]).filter(Boolean) : [];
}
/** Official evidence that hikers may use a USFS trail. */
export function usfsHikeable(a: Record<string, unknown>) {
  return a.trail_type === "TERRA" && ((typeof a.allowed_terra_use === "string" && a.allowed_terra_use.includes("1")) || a.hiker_pedestrian_managed != null || a.hiker_pedestrian_accpt != null);
}

/** Agency names are often in capitals ("BIG SPRINGS"); show them in title case, keeping codes as they are. */
export function titleCaseName(name: string) {
  if (name !== name.toUpperCase() || !/[A-Z]/.test(name)) return name;
  return name.toLowerCase().replace(/\b([a-z])([a-z']*)/g, (word, first, rest) => (/^(of|the|and|to|at|on|in|a)$/.test(word) ? word : first.toUpperCase() + rest))
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\b(nf|fs|nfs|blm|nps|ohv|atv|us|ii|iii|iv)\b/gi, (w) => w.toUpperCase());
}

export function trailTypeFor(row: Pick<CatalogTrail, "name" | "miles" | "surface" | "source" | "tags" | "kind"> & { uses?: string[] }): TrailType {
  const n = row.name.toLowerCase();
  if (row.source === "resort") return "resort-hiking";
  if (/\bboardwalk\b/.test(n) || /boardwalk/i.test(row.surface ?? "")) return "boardwalk";
  if (/\b(accessible|ada|all ?access|wheelchair)\b/.test(n)) return "accessible";
  if (/\b(nature|interpretive|discovery|braille)\b/.test(n)) return "nature";
  if (row.kind === "route" || (row.miles ?? 0) >= 15) return "backpacking";
  if (/\bscenic\b/.test(n)) return "scenic";
  const uses = row.uses ?? [];
  if (uses.some((u) => u !== "Hiking") && uses.includes("Hiking")) return "multi-use";
  if (/\bmulti ?-?use\b/.test(n) || row.tags?.includes("multi-use")) return "multi-use";
  return "hiking";
}

/** Confidence from source strength and the automated quality checks. */
export function confidenceFor(row: Pick<CatalogTrail, "quality" | "flags" | "winterUse" | "source" | "kind"> & { sources?: SourceRef[] }): Confidence {
  const flags = row.flags ?? [];
  if (row.quality === "fragment" || row.winterUse === "downhill" || flags.includes("sidewalk") || flags.includes("motorized") || flags.includes("no-hiking")) return "REJECTED";
  if (row.source === "resort") return "NEEDS_REVIEW";
  if (row.quality === "review") return "NEEDS_REVIEW";
  if (row.kind === "route") return "VERIFIED";
  return row.sources?.length ? "OFFICIAL_GEOMETRY_VERIFIED" : "VERIFIED";
}

/**
 * Season text worth showing. USGS "seasonopen" is Yes (seasonal) / No (not seasonal) / Unknown, so only
 * "Yes" and real descriptions ("Open March 1 to November 30") survive; "No" and "Unknown" mean none.
 */
export function normalizeSeason(season: string | null | undefined) {
  const value = season?.trim();
  if (!value || /^(no|n|unknown|null|n\/a|none|-)$/i.test(value)) return null;
  if (/^(yes|y)$/i.test(value)) return "Seasonal";
  return value;
}

export function trailStatusFor(row: Pick<CatalogTrail, "flags" | "season">, closed = false): TrailStatus {
  if (closed || row.flags?.includes("closed")) return "CLOSED";
  return normalizeSeason(row.season) ? "SEASONAL" : "UNKNOWN";
}
