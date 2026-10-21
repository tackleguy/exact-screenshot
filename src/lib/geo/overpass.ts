/**
 * Dynamic OpenStreetMap Geodata Integration via Overpass API.
 *
 * Fetches, parses, and normalizes:
 * - Hiking & Foot Route Relations (`route=hiking|foot|trail`)
 * - Technical Attributes (`sac_scale`, `trail_visibility`, `surface`, `incline`)
 * - Ski Pistes (`piste:type=downhill|nordic|skitour`), Aerial Lifts (`aerialway`), Winter Sports boundaries
 * - Mountain POIs (Trailheads, Drinking Water, Campsites, Peaks/Summits, Parking)
 */

export interface OsmTrailProperties {
  id: string;
  name: string;
  kind: "trail" | "thru-hike" | "piste" | "lift" | "poi";
  activity: "hike" | "bike" | "ski" | "poi";
  sacScale?: string; // T1 (hiking) to T6 (difficult alpine)
  trailVisibility?: string; // excellent, good, intermediate, bad, horrible, no
  surface?: string; // ground, dirt, rock, gravel, paved
  incline?: string;
  pisteType?: string; // downhill, nordic, skitour, sled
  pisteDifficulty?: "novice" | "easy" | "intermediate" | "advanced" | "expert" | "freeride";
  aerialway?: string; // chair_lift, gondola, drag_lift
  poiType?: "trailhead" | "water" | "campsite" | "peak" | "parking";
  elevationM?: number;
  distanceKm?: number;
  rawTags: Record<string, string>;
}

export type OsmFeature = GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString | GeoJSON.Point, OsmTrailProperties>;

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// Memory cache for bounding box queries
const overpassCache = new Map<string, { data: GeoJSON.FeatureCollection<GeoJSON.Geometry, OsmTrailProperties>; timestamp: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** Bounding box in EPSG:4326 [south, west, north, east] */
export type BoundingBox = [number, number, number, number];

/** Standardize SAC scale into consumer friendly labels */
export function normalizeSacScale(sac?: string): string | undefined {
  if (!sac) return undefined;
  const s = sac.toLowerCase().replace(/_/g, " ").trim();
  if (s.includes("t6") || s.includes("difficult alpine")) return "T6 Difficult Alpine";
  if (s.includes("t5") || s.includes("demanding alpine")) return "T5 Demanding Alpine";
  if (s.includes("t4") || s.includes("alpine hiking") || s.includes("alpine")) return "T4 Alpine Hiking";
  if (s.includes("t3") || s.includes("demanding mountain")) return "T3 Demanding Mountain";
  if (s.includes("t2") || s.includes("mountain hiking") || s.includes("mountain")) return "T2 Mountain Hiking";
  if (s.includes("t1") || s.includes("hiking")) return "T1 Hiking";
  return sac;
}

/** Standardize piste difficulty into colors and normalized levels */
export function normalizePisteDifficulty(diff?: string): OsmTrailProperties["pisteDifficulty"] {
  if (!diff) return undefined;
  const d = diff.toLowerCase().trim();
  if (d === "novice" || d === "green") return "novice";
  if (d === "easy" || d === "blue") return "easy";
  if (d === "intermediate" || d === "red") return "intermediate";
  if (d === "advanced" || d === "black") return "advanced";
  if (d === "expert" || d === "double_black" || d === "double-black") return "expert";
  if (d === "freeride") return "freeride";
  return "intermediate";
}

/**
 * Construct an Overpass QL query covering trails, relations, ski infrastructure, and POIs
 */
export function buildOverpassQuery([south, west, north, east]: BoundingBox): string {
  const bboxStr = `${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)}`;
  return `
[out:json][timeout:25];
(
  // Designated Hiking & Multi-Use Routes (Relations)
  relation["route"~"hiking|foot|trail|bicycle|mtb"](${bboxStr});
  
  // Outdoor Paths & Singletracks (Ways)
  way["highway"~"path|footway|bridleway|cycleway|track"]["foot"!="no"]["access"!="private"](${bboxStr});

  // Winter Sports & Ski Infrastructure
  way["piste:type"](${bboxStr});
  way["aerialway"](${bboxStr});
  relation["site"="piste"](${bboxStr});

  // Outdoor POIs
  node["highway"="trailhead"](${bboxStr});
  node["tourism"="camp_site"](${bboxStr});
  node["amenity"="drinking_water"](${bboxStr});
  node["natural"="peak"](${bboxStr});
  node["amenity"="parking"]["tourism"](${bboxStr});
);
out body;
>;
out skel qt;
`.trim();
}

interface OverpassNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

interface OverpassWay {
  type: "way";
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}

interface OverpassRelation {
  type: "relation";
  id: number;
  members: { type: "way" | "node" | "relation"; ref: number; role: string }[];
  tags?: Record<string, string>;
}

type OverpassElement = OverpassNode | OverpassWay | OverpassRelation;

/**
 * Parses raw Overpass JSON response into normalized GeoJSON
 */
export function parseOverpassJson(elements: OverpassElement[]): GeoJSON.FeatureCollection<GeoJSON.Geometry, OsmTrailProperties> {
  const nodes = new Map<number, [number, number]>();
  const ways = new Map<number, OverpassWay>();
  const relations: OverpassRelation[] = [];
  const features: OsmFeature[] = [];

  for (const el of elements) {
    if (el.type === "node") {
      nodes.set(el.id, [el.lon, el.lat]);
      // If node is an independent POI
      if (el.tags && (el.tags.natural === "peak" || el.tags.tourism === "camp_site" || el.tags.amenity === "drinking_water" || el.tags.highway === "trailhead")) {
        let poiType: OsmTrailProperties["poiType"] = "trailhead";
        if (el.tags.natural === "peak") poiType = "peak";
        else if (el.tags.amenity === "drinking_water") poiType = "water";
        else if (el.tags.tourism === "camp_site") poiType = "campsite";
        else if (el.tags.amenity === "parking") poiType = "parking";

        const elev = el.tags.ele ? parseFloat(el.tags.ele) : undefined;
        features.push({
          type: "Feature",
          id: `osm-node-${el.id}`,
          properties: {
            id: `osm-node-${el.id}`,
            name: el.tags.name || (poiType === "peak" ? "Mountain Peak" : poiType.toUpperCase()),
            kind: "poi",
            activity: "poi",
            poiType,
            elevationM: elev,
            rawTags: el.tags,
          },
          geometry: {
            type: "Point",
            coordinates: [el.lon, el.lat],
          },
        });
      }
    } else if (el.type === "way") {
      ways.set(el.id, el);
    } else if (el.type === "relation") {
      relations.push(el);
    }
  }

  // Helper to extract LineString coordinates from a way
  const extractWayCoords = (way: OverpassWay): [number, number][] => {
    const coords: [number, number][] = [];
    for (const nodeId of way.nodes) {
      const pt = nodes.get(nodeId);
      if (pt) coords.push(pt);
    }
    return coords;
  };

  // 1. Process Route Relations (Long distance trails, thru-hikes, ski circuits)
  const consumedWayIds = new Set<number>();
  for (const rel of relations) {
    const tags = rel.tags || {};
    const routeType = tags.route || tags["piste:type"];
    const name = tags.name || tags.ref || "Designated Route";
    const multiLines: [number, number][][] = [];

    for (const mem of rel.members) {
      if (mem.type === "way") {
        const way = ways.get(mem.ref);
        if (way) {
          const coords = extractWayCoords(way);
          if (coords.length > 1) {
            multiLines.push(coords);
            consumedWayIds.add(way.id);
          }
        }
      }
    }

    if (multiLines.length > 0) {
      const isSki = routeType === "piste" || tags.site === "piste";
      const isMtb = routeType === "mtb" || routeType === "bicycle";

      features.push({
        type: "Feature",
        id: `osm-rel-${rel.id}`,
        properties: {
          id: `osm-rel-${rel.id}`,
          name,
          kind: isSki ? "piste" : tags.network === "iwn" || tags.network === "nwn" ? "thru-hike" : "trail",
          activity: isSki ? "ski" : isMtb ? "bike" : "hike",
          sacScale: normalizeSacScale(tags.sac_scale),
          trailVisibility: tags.trail_visibility,
          surface: tags.surface,
          pisteDifficulty: normalizePisteDifficulty(tags["piste:difficulty"]),
          pisteType: tags["piste:type"],
          rawTags: tags,
        },
        geometry: {
          type: "MultiLineString",
          coordinates: multiLines,
        },
      });
    }
  }

  // 2. Process Individual Ways (Day trails, singletracks, pistes, lifts)
  for (const [wayId, way] of ways.entries()) {
    const tags = way.tags || {};
    const coords = extractWayCoords(way);
    if (coords.length < 2) continue;

    const isLift = Boolean(tags.aerialway);
    const isPiste = Boolean(tags["piste:type"]);
    const isBike = tags.highway === "cycleway" || tags.bicycle === "designated" || Boolean(tags["mtb:scale"]);

    const kind: OsmTrailProperties["kind"] = isLift ? "lift" : isPiste ? "piste" : "trail";
    const activity: OsmTrailProperties["activity"] = isPiste || isLift ? "ski" : isBike ? "bike" : "hike";

    const name = tags.name || (isLift ? `${tags.aerialway} Lift` : isPiste ? "Ski Run" : "Trail");

    features.push({
      type: "Feature",
      id: `osm-way-${wayId}`,
      properties: {
        id: `osm-way-${wayId}`,
        name,
        kind,
        activity,
        sacScale: normalizeSacScale(tags.sac_scale),
        trailVisibility: tags.trail_visibility,
        surface: tags.surface,
        incline: tags.incline,
        pisteDifficulty: normalizePisteDifficulty(tags["piste:difficulty"]),
        pisteType: tags["piste:type"],
        aerialway: tags.aerialway,
        rawTags: tags,
      },
      geometry: {
        type: "LineString",
        coordinates: coords,
      },
    });
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

/**
 * Fetch dynamic OSM geospatial data for a given bounding box with multi-endpoint fallback.
 */
export async function fetchLiveOsmTrails(
  bbox: BoundingBox,
  signal?: AbortSignal,
): Promise<GeoJSON.FeatureCollection<GeoJSON.Geometry, OsmTrailProperties>> {
  const cacheKey = bbox.map((n) => n.toFixed(3)).join(",");
  const cached = overpassCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const query = buildOverpassQuery(bbox);
  let lastError: Error | null = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal,
      });

      if (!res.ok) {
        throw new Error(`Overpass returned HTTP ${res.status}`);
      }

      const json = await res.json();
      const featureCollection = parseOverpassJson(json.elements || []);

      overpassCache.set(cacheKey, { data: featureCollection, timestamp: Date.now() });
      if (overpassCache.size > 50) {
        const oldest = overpassCache.keys().next().value!;
        overpassCache.delete(oldest);
      }

      return featureCollection;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Continue to next endpoint fallback
    }
  }

  throw lastError || new Error("Failed to query Overpass API across all mirrors.");
}
