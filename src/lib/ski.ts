export interface SkiArea {
  id: string;
  name: string;
  country?: string;
  region?: string;
  lat: number;
  lng: number;
  runs_count?: number;
  lifts_count?: number;
  activities?: string[];
}

export type SkiFeatureType = "skiArea" | "run" | "lift";

export interface SkiFeatureSummary {
  id: string;
  name: string;
  type: SkiFeatureType;
  uses?: string[];
  activities?: string[];
  difficulty?: string;
  status?: string;
  lat: number;
  lng: number;
  runs_count?: number;
  lifts_count?: number;
  liftType?: string;
}

const API_BASE =
  process.env.NEXT_PUBLIC_SKI_API_URL ?? "https://api.openskimap.org";

interface GeoFeature {
  type: string;
  properties?: Record<string, unknown>;
  geometry?: {
    type: string;
    coordinates: number[] | number[][] | number[][][];
  };
}

function centroidFromGeometry(geometry?: GeoFeature["geometry"]): {
  lat: number;
  lng: number;
} {
  if (!geometry) return { lat: 0, lng: 0 };

  let coords: number[][] = [];

  if (geometry.type === "Point") {
    const c = geometry.coordinates as number[];
    return { lng: c[0], lat: c[1] };
  }

  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates as unknown as number[][][];
    coords = rings[0] ?? [];
  } else if (geometry.type === "MultiPolygon") {
    const polys = geometry.coordinates as unknown as number[][][][];
    coords = polys[0]?.[0] ?? [];
  } else if (geometry.type === "LineString") {
    coords = geometry.coordinates as unknown as number[][];
  } else if (geometry.type === "MultiLineString") {
    const lines = geometry.coordinates as unknown as number[][][];
    coords = lines[0] ?? [];
  }

  if (coords.length === 0) return { lat: 0, lng: 0 };

  const sum = coords.reduce(
    (acc, c) => ({ lng: acc.lng + c[0], lat: acc.lat + c[1] }),
    { lng: 0, lat: 0 },
  );

  return { lng: sum.lng / coords.length, lat: sum.lat / coords.length };
}

function parseSkiArea(feature: GeoFeature): SkiArea | null {
  const props = feature.properties ?? {};
  if (props.type !== "skiArea") return null;
  const id = String(props.id ?? "");
  const name = String(props.name ?? "");
  if (!id || !name) return null;

  const { lat, lng } = centroidFromGeometry(feature.geometry);

  const places = props.places as
    | { localized?: { en?: { region?: string; country?: string } } }[]
    | undefined;
  const place = places?.[0]?.localized?.en;

  const stats = props.statistics as
    | { runs?: { count?: number }; lifts?: { count?: number } }
    | undefined;

  return {
    id,
    name,
    country: place?.country,
    region: place?.region,
    lat,
    lng,
    runs_count: stats?.runs?.count,
    lifts_count: stats?.lifts?.count,
    activities: props.activities as string[] | undefined,
  };
}

export function parseSkiFeature(feature: GeoFeature): SkiFeatureSummary | null {
  const props = feature.properties ?? {};
  const id = String(props.id ?? "");
  const type = props.type as SkiFeatureType;
  if (!id || !["skiArea", "run", "lift"].includes(type)) return null;

  const name = String(props.name ?? (type === "lift" ? "Lift" : "Unnamed"));
  const { lat, lng } = centroidFromGeometry(feature.geometry);
  if (lat === 0 && lng === 0) return null;

  const stats = props.statistics as
    | { runs?: { count?: number }; lifts?: { count?: number } }
    | undefined;

  return {
    id,
    name,
    type,
    uses: props.uses as string[] | undefined,
    activities: props.activities as string[] | undefined,
    difficulty: props.difficulty as string | undefined,
    status: props.status as string | undefined,
    lat,
    lng,
    runs_count: stats?.runs?.count,
    lifts_count: stats?.lifts?.count,
    liftType: props.liftType as string | undefined,
  };
}

export function formatSkiUses(uses?: string[], activities?: string[]): string {
  const labels: Record<string, string> = {
    downhill: "Downhill",
    nordic: "Cross-country",
    skitour: "Ski touring",
    hike: "Hike",
    sled: "Sled",
    snow_park: "Terrain park",
  };
  const items = [...(uses ?? []), ...(activities ?? [])];
  const unique = [...new Set(items)];
  return unique.map((u) => labels[u] ?? u).join(" · ") || "Ski";
}

export function difficultyColor(difficulty?: string): string {
  switch (difficulty) {
    case "novice":
    case "easy":
      return "bg-green-600";
    case "intermediate":
    case "moderate":
      return "bg-blue-600";
    case "advanced":
      return "bg-stone-900";
    case "expert":
    case "freeride":
      return "bg-stone-900 ring-2 ring-red-600";
    default:
      return "bg-sky-600";
  }
}

export async function searchSkiAreas(query: string, limit = 8): Promise<SkiArea[]> {
  const term = query.trim();
  if (!term) return [];

  try {
    const res = await fetch(
      `${API_BASE}/search?query=${encodeURIComponent(term)}&limit=${limit}`,
      { next: { revalidate: 3600 } },
    );

    if (!res.ok) return [];

    const data = (await res.json()) as GeoFeature[];
    if (!Array.isArray(data)) return [];

    return data
      .map(parseSkiArea)
      .filter((a): a is SkiArea => a !== null && a.lat !== 0 && a.lng !== 0);
  } catch {
    return [];
  }
}

export async function getSkiFeature(id: string): Promise<SkiFeatureSummary | null> {
  try {
    const res = await fetch(`${API_BASE}/features/${id}.geojson`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as GeoFeature;
    return parseSkiFeature(data);
  } catch {
    return null;
  }
}

export async function getSkiArea(id: string): Promise<SkiArea | null> {
  const feature = await getSkiFeature(id);
  if (!feature || feature.type !== "skiArea") return null;
  return {
    id: feature.id,
    name: feature.name,
    lat: feature.lat,
    lng: feature.lng,
    runs_count: feature.runs_count,
    lifts_count: feature.lifts_count,
    activities: feature.activities,
  };
}

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function reverseGeocodeRegion(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      {
        headers: { "User-Agent": "Hyked/1.0 (health app)" },
        next: { revalidate: 86400 },
      },
    );
    if (!res.ok) return "";
    const data = (await res.json()) as {
      address?: { state?: string; country?: string; region?: string };
    };
    return (
      data.address?.state ??
      data.address?.region ??
      data.address?.country ??
      ""
    );
  } catch {
    return "";
  }
}

export async function searchSkiAreasNearby(
  lat: number,
  lng: number,
  radiusKm = 120,
  limit = 25,
): Promise<(SkiArea & { distance_km: number })[]> {
  const region = await reverseGeocodeRegion(lat, lng);
  const queries = region
    ? [region, `${region} ski`, "ski resort"]
    : ["ski resort"];

  const seen = new Set<string>();
  const areas: SkiArea[] = [];

  for (const q of queries) {
    const results = await searchSkiAreas(q, 40);
    for (const area of results) {
      if (!seen.has(area.id)) {
        seen.add(area.id);
        areas.push(area);
      }
    }
    if (areas.length >= limit * 2) break;
  }

  return areas
    .map((area) => ({
      ...area,
      distance_km: haversineKm(lat, lng, area.lat, area.lng),
    }))
    .filter((a) => a.distance_km <= radiusKm)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, limit);
}

export function skiFeatureFromMapProperties(
  props: Record<string, unknown>,
): SkiFeatureSummary | null {
  const id = String(props.id ?? "");
  const type = props.type as SkiFeatureType;
  if (!id || !type) return null;

  return {
    id,
    name: String(props.name ?? (type === "lift" ? "Lift" : "Feature")),
    type,
    uses: props.uses as string[] | undefined,
    activities: props.activities as string[] | undefined,
    difficulty: props.difficulty as string | undefined,
    status: props.status as string | undefined,
    lat: 0,
    lng: 0,
    liftType: props.liftType as string | undefined,
  };
}
