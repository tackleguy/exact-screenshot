import { resolveDifficulty } from "@/lib/trail-difficulty";
import type { CatalogBounds, CatalogFilters, CatalogTrail } from "./types";
import { countryName } from "./types";
import { withinBounds } from "./map";
import { isWinterActivityTrail } from "./winter";
import { matchesCatalogActivity, parseCatalogActivity } from "./activity";
import { dedupeSectionsByName } from "./through-hikes";

export const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();

export function searchableText(trail: CatalogTrail) {
  const place = `${countryName(trail.country)} ${trail.country}`;
  const kindLabel = trail.kind === "route" ? "through hike thru-hike long trail route" : "section";
  return normalize(
    [trail.name, trail.region, place, trail.manager, kindLabel, ...(trail.tags ?? [])].join(" "),
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
  const includeWinter = filters.includeWinter === true || activity === "ski";
  const difficulties = filters.difficulty ? new Set(filters.difficulty.split(",").map((d) => normalize(d))) : null;
  return rows.filter((r, i) => {
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
    if (filters.bbox && !withinBounds(r.longitude, r.latitude, filters.bbox)) return false;
    if (filters.country === "intl") {
      if (r.country === "US" || r.country === "CA") return false;
    } else if (filters.country && r.country !== filters.country) {
      return false;
    }
    if (filters.region && normalize(filters.region ?? "") !== normalize(r.region ?? "")) return false;
    if (terms.length && !terms.every((t) => (texts?.[i] ?? searchableText(r)).includes(t))) return false;
    if (filters.minMiles !== undefined && (r.miles === null || r.miles < filters.minMiles)) return false;
    if (filters.maxMiles !== undefined && (r.miles === null || r.miles > filters.maxMiles)) return false;
    // Reported difficulty when the source gives one, otherwise the same estimate the trail page shows.
    if (difficulties && !difficulties.has(resolveDifficulty({ reported: r.difficulty, miles: r.miles, name: r.name, elevationFt: r.elevationFt ? r.elevationFt.max - r.elevationFt.min : null }).difficulty)) return false;
    if (filters.routeType && r.routeType !== filters.routeType) return false;
    if (filters.dogFriendly && r.dogs !== true) return false;
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
  if (filters.targetMiles !== undefined && Number.isFinite(filters.targetMiles) && filters.targetMiles > 0) {
    matches.sort(
      (a, b) =>
        (a.miles === null ? Infinity : Math.abs(a.miles - filters.targetMiles!)) -
          (b.miles === null ? Infinity : Math.abs(b.miles - filters.targetMiles!)) ||
        a.name.localeCompare(b.name),
    );
  }
  if (Number.isFinite(filters.lat) && Number.isFinite(filters.lng) && filters.targetMiles === undefined) {
    matches.sort(
      (a, b) =>
        distanceKm(filters.lat!, filters.lng!, a.latitude, a.longitude) -
          distanceKm(filters.lat!, filters.lng!, b.latitude, b.longitude) || a.id.localeCompare(b.id),
    );
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

export function parseCatalogFilters(params: URLSearchParams): CatalogFilters {
  const number = (key: string, min: number, max: number) => {
    const raw = params.get(key);
    if (!raw?.trim()) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
  };
  const countryRaw = params.get("country")?.trim().toUpperCase();
  const knownCountries = new Set([
    "US",
    "CA",
    "FR",
    "IT",
    "CH",
    "SE",
    "CL",
    "IS",
    "NP",
    "PE",
    "NZ",
    "AU",
    "TZ",
    "ES",
    "GR",
    "TR",
    "BT",
    "ZA",
    "AR",
  ]);
  const country =
    countryRaw === "INTL"
      ? "intl"
      : countryRaw && knownCountries.has(countryRaw)
        ? countryRaw
        : undefined;
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
    minMiles: number("minMiles", 0, 10000),
    maxMiles: number("maxMiles", 0, 10000),
    difficulty: params.get("difficulty")?.slice(0, 40) || undefined,
    routeType: (["loop", "point-to-point", "network"] as const).find((t) => t === params.get("routeType")),
    dogFriendly: params.get("dogFriendly") === "true",
    includeWinter: params.get("includeWinter") === "true" || activity === "ski",
    activity,
    kind,
    uniqueNames: params.get("uniqueNames") === "true",
    includeFragments: params.get("includeFragments") === "true",
    resort: params.get("resort")?.slice(0, 100) || undefined,
    sourceType: (params.get("sourceType")?.toUpperCase().replace(/[^A-Z_]/g, "") || undefined) as CatalogFilters["sourceType"],
    lat: number("lat", -90, 90),
    lng: number("lng", -180, 180),
    radiusKm: number("radiusKm", 0.1, 1000),
  };
}
