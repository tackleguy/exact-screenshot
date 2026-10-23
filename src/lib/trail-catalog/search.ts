import { resolveDifficulty } from "@/lib/trail-difficulty";
import { matchScore, placeMatch, searchEntry, searchRank, type SearchEntry } from "./fuzzy";

const entries = new WeakMap<CatalogTrail, SearchEntry>();
const entryOf = (t: CatalogTrail) => entries.get(t) ?? (entries.set(t, searchEntry(t)), entries.get(t)!);
/** Text-match score of the last query each row was checked against, for ranking. */
const lastMatch = new WeakMap<CatalogTrail, number>();
const lastPlace = new WeakMap<CatalogTrail, boolean>();
import type { CatalogBounds, CatalogFilters, CatalogTrail } from "./types";
import { countryName } from "./types";
import { boundsOverlap, withinBounds } from "./map";
import { isWinterActivityTrail } from "./winter";
import { matchesCatalogActivity, parseCatalogActivity } from "./activity";
import { dedupeSectionsByName } from "./through-hikes";
import { trailSacScale } from "./types";

export const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();

export function searchableText(trail: CatalogTrail) {
  const place = `${countryName(trail.country)} ${trail.country}`;
  const kindLabel = trail.kind === "route" ? "through hike thru-hike long trail route" : "section";
  const peakLabel = trail.peakCategory ? `summit peak ${trail.peakCategory} 14er 8000m eight-thousander seven summits` : "";
  const partOf = trail.partOfRoute ? `section of ${trail.partOfRoute.name}` : "";
  return normalize(
    [trail.name, trail.region, place, trail.manager, kindLabel, peakLabel, partOf, ...(trail.tags ?? [])].join(" "),
  );
}

export function distanceKm(a: number, b: number, c: number, d: number) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((c - a) * rad) / 2) ** 2 +
    Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(((d - b) * rad) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function matchingCatalogRows(rows: CatalogTrail[], filters: CatalogFilters, texts?: string[], reviews?: Map<string, "approve" | "reject">) {
  const terms = normalize((filters.q ?? "").slice(0, 180))
    .split(/\s+/)
    .filter(Boolean);
  const activity = filters.activity ?? "hike";
  const includeWinter = filters.includeWinter === true || activity === "ski" || activity === "sled" || activity === "all";
  const difficulties = filters.difficulty ? new Set(filters.difficulty.split(",").map((d) => normalize(d))) : null;
  const query = (filters.q ?? "").slice(0, 180);
  return rows.filter((r, i) => {
    // Official records merged into a whole trail are only reachable through their redirect.
    if (r.mergedInto && !filters.includeFragments) return false;
    if (filters.collection === "14ers" && r.peakCategory !== "14er" && !r.tags?.includes("14er")) return false;
    if (filters.collection === "8000m" && r.peakCategory !== "8000m" && !r.tags?.includes("8000m")) return false;
    if (filters.collection === "7summits" && r.peakCategory !== "seven-summits" && !r.tags?.includes("Seven Summits")) return false;
    if (filters.collection === "peaks" && !r.peakCategory) return false;
    if (filters.collection === "thru-hikes" && (r.kind !== "route" || r.peakCategory)) return false;
    if ((filters.collection === "thru-sections" || filters.thruHikeSections) && !r.partOfRoute) return false;
    if (filters.peakCategory && r.peakCategory !== filters.peakCategory) return false;

    if (!includeWinter && isWinterActivityTrail(r)) return false;
    if (activity !== "all" && !matchesCatalogActivity(r, activity)) return false;
    // An admin decision overrides the automated checks: rejected trails are hidden, approved ones shown.
    const review = reviews?.get(r.id);
    if (review === "reject" && !filters.includeFragments) return false;
    const approved = review === "approve";
    // Pieces of longer trails, unnamed stubs, connectors and closed trails are not presented as hikes unless asked for.
    if (!approved && !filters.includeFragments && (r.quality === "fragment" || r.flags?.includes("closed"))) return false;
    // Sidewalks and road sidepaths are not hikes; they stay listed for biking.
    if (!approved && !filters.includeFragments && activity !== "bike" && activity !== "path-bike" && activity !== "all" && r.flags?.includes("sidewalk")) return false;
    // Motorized routes are not hikes, runs or bike rides; they show only with every activity or partial segments.
    if (!approved && !filters.includeFragments && activity !== "all" && r.flags?.includes("motorized")) return false;
    // The managing agency says hiking isn't an allowed use here.
    if (!approved && !filters.includeFragments && (activity === "hike" || activity === "walk" || activity === "backpack" || activity === "run") && r.flags?.includes("no-hiking")) return false;
    if (filters.resort && normalize(r.skiResort ?? "") !== normalize(filters.resort)) return false;
    if (filters.sourceType && r.sourceType !== filters.sourceType) return false;
    if (filters.kind && r.kind !== filters.kind) return false;
    // A trail is in view when any part of its line is (its pin may be outside the box).
    if (filters.bbox && !(r.bounds ? boundsOverlap(r.bounds, filters.bbox) : withinBounds(r.longitude, r.latitude, filters.bbox))) return false;
    if (filters.country === "intl") {
      if (r.country === "US" || r.country === "CA") return false;
    } else if (filters.country && r.country !== filters.country) {
      return false;
    }
    if (filters.region && normalize(filters.region ?? "") !== normalize(r.region ?? "")) return false;
    if (terms.length) {
      const fuzzy = matchScore(query, entryOf(r));
      // Keyword fallback keeps searches like "14er" or "thru-hike" that match labels rather than names.
      const keyword = fuzzy > 0 || terms.every((t) => (texts?.[i] ?? searchableText(r)).includes(t)) ? Math.max(fuzzy, 0.3) : 0;
      if (!keyword) return false;
      lastMatch.set(r, keyword);
      lastPlace.set(r, placeMatch(query, entryOf(r)));
    }
    if (filters.minMiles !== undefined && (r.miles === null || r.miles < filters.minMiles)) return false;
    if (filters.maxMiles !== undefined && (r.miles === null || r.miles > filters.maxMiles)) return false;
    // Reported difficulty when the source gives one, otherwise the same estimate the trail page shows.
    if (difficulties && !difficulties.has(resolveDifficulty({ reported: r.difficulty, miles: r.miles, sacScale: trailSacScale(r) }).difficulty)) return false;
    if (filters.routeType && r.routeType !== filters.routeType) return false;
    if (filters.dogFriendly && r.dogs !== true) return false;
    if (filters.verified && r.tier !== "verified") return false;
    if (
      Number.isFinite(filters.lat) &&
      Number.isFinite(filters.lng) &&
      distanceKm(filters.lat!, filters.lng!, r.latitude, r.longitude) > (filters.radiusKm ?? 50)
    ) {
      return false;
    }
    return true;
  });
}

export function filterCatalog(rows: CatalogTrail[], filters: CatalogFilters, texts?: string[], reviews?: Map<string, "approve" | "reject">) {
  let matches = matchingCatalogRows(rows, filters, texts, reviews);
  if (filters.uniqueNames) matches = dedupeSectionsByName(matches);
  // Sections together: when a route and its stages both match, show the route (its page lists the stages).
  // A search keeps the stages, so a stage can be found by its own name.
  if (!filters.q?.trim() && !filters.includeFragments && filters.collection !== "thru-sections" && !filters.thruHikeSections) {
    const ids = new Set(matches.map((r) => r.id));
    matches = matches.filter((r) => !r.partOfRoute || !ids.has(r.partOfRoute.id));
  }
  if (filters.targetMiles !== undefined && Number.isFinite(filters.targetMiles) && filters.targetMiles > 0) {
    matches.sort(
      (a, b) =>
        (a.miles === null ? Infinity : Math.abs(a.miles - filters.targetMiles!)) -
          (b.miles === null ? Infinity : Math.abs(b.miles - filters.targetMiles!)) ||
        a.name.localeCompare(b.name),
    );
  }
  const nearby = Number.isFinite(filters.lat) && Number.isFinite(filters.lng) && filters.targetMiles === undefined;
  if (filters.q?.trim() && filters.targetMiles === undefined) {
    // Best text match first; the quality score orders trails that match equally well.
    const rank = (t: CatalogTrail) => searchRank(lastMatch.get(t) ?? 0, t.qualityScore, lastPlace.get(t));
    matches.sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id));
  } else if (nearby) {
    // Near you: distance, discounted for better-documented trails (40 score points halve the distance).
    const key = (t: CatalogTrail) => distanceKm(filters.lat!, filters.lng!, t.latitude, t.longitude) / (1 + Math.max(0, t.qualityScore ?? 0) / 40);
    matches.sort((a, b) => key(a) - key(b) || a.id.localeCompare(b.id));
  } else if (filters.targetMiles === undefined) {
    matches.sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0));
  }
  if (filters.sort === "short" || filters.sort === "long") {
    const dir = filters.sort === "short" ? 1 : -1;
    matches.sort((a, b) => (a.miles === null ? 1 : b.miles === null ? -1 : dir * (a.miles - b.miles)));
  }
  const limit = Number.isFinite(filters.limit) ? Math.min(48, Math.max(1, Math.floor(filters.limit!))) : 24;
  const pages = Math.max(1, Math.ceil(matches.length / limit));
  const page = Number.isFinite(filters.page) ? Math.min(pages, Math.max(1, Math.floor(filters.page!))) : 1;
  return { trails: matches.slice((page - 1) * limit, page * limit), total: matches.length, page, pages, limit };
}

export function parseCatalogBounds(value: string | null): CatalogBounds | undefined {
  if (!value) return undefined;
  const parts = value.split(",");
  if (parts.length !== 4 || parts.some((part) => !part.trim())) return undefined;
  const bounds = parts.map(Number) as CatalogBounds;
  const [west, south, east, north] = bounds;
  if (
    !bounds.every(Number.isFinite) ||
    west < -180 ||
    west > 180 ||
    east < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90 ||
    south > north
  ) {
    return undefined;
  }
  return bounds;
}

/** "3-8" → [3, 8]; "15-" → [15, undefined]; anything else → no limits. */
function lengthPreset(value: string | null): [number | undefined, number | undefined] {
  const m = /^(\d+(?:\.\d+)?)?-(\d+(?:\.\d+)?)?$/.exec(value ?? "");
  return m ? [m[1] ? Number(m[1]) : undefined, m[2] ? Number(m[2]) : undefined] : [undefined, undefined];
}

export function parseCatalogFilters(params: URLSearchParams): CatalogFilters {
  const number = (key: string, min: number, max: number) => {
    const raw = params.get(key);
    if (!raw?.trim()) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
  };
  const countryRaw = params.get("country")?.trim().toUpperCase();
  const country = countryRaw === "INTL" ? "intl" : countryRaw && /^[A-Z]{2}$/.test(countryRaw) && countryRaw !== "ZZ" && countryName(countryRaw) !== countryRaw ? countryRaw : undefined;
  const kindRaw = params.get("kind");
  const kind = kindRaw === "route" || kindRaw === "segment" ? kindRaw : undefined;
  const activity = parseCatalogActivity(params.get("activity")) ?? "hike";
  return {
    targetMiles: number("targetMiles", 0.1, 10000),
    bbox: parseCatalogBounds(params.get("bbox")),
    q: params.get("q")?.trim().slice(0, 180),
    country,
    region: params.get("region")?.slice(0, 100),
    page: number("page", 1, 100000),
    limit: number("limit", 1, 48),
    // `length` is the list page's preset ("3-8", "15-"); explicit minMiles/maxMiles win.
    minMiles: number("minMiles", 0, 10000) ?? lengthPreset(params.get("length"))[0],
    maxMiles: number("maxMiles", 0, 10000) ?? lengthPreset(params.get("length"))[1],
    difficulty: params.get("difficulty")?.slice(0, 40) || undefined,
    routeType: (["loop", "point-to-point", "network"] as const).find((t) => t === params.get("routeType")),
    dogFriendly: params.get("dogFriendly") === "true",
    includeWinter: params.get("includeWinter") === "true" || activity === "ski" || activity === "sled",
    activity,
    kind,
    uniqueNames: params.get("uniqueNames") === "true",
    includeFragments: params.get("includeFragments") === "true",
    resort: params.get("resort")?.slice(0, 100) || undefined,
    sourceType: (params.get("sourceType")?.toUpperCase().replace(/[^A-Z_]/g, "") || undefined) as CatalogFilters["sourceType"],
    lat: number("lat", -90, 90),
    lng: number("lng", -180, 180),
    radiusKm: number("radiusKm", 0.1, 1000),
    collection: params.get("collection")?.trim().toLowerCase() || undefined,
    peakCategory: (["14er", "8000m", "seven-summits"] as const).find((c) => c === params.get("peakCategory")),
    thruHikeSections: params.get("thruHikeSections") === "true",
    verified: params.get("verified") === "true",
    sort: (["best", "short", "long"] as const).find((v) => v === params.get("sort")),
  };
}
