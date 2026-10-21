import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toWebMercator,
  toWgs84,
  haversineMeters,
  snapPointToLine,
  snapPointToNearestLine,
  snapGpsTraceToTrail,
  simplifyForZoom,
  dynamicZoomTolerance,
  type LngLat,
} from "./snap";
import {
  buildOverpassQuery,
  parseOverpassJson,
  normalizeSacScale,
  normalizePisteDifficulty,
} from "./overpass";

test("geospatial: coordinate projection EPSG:4326 <-> EPSG:3857 roundtrip", () => {
  const original: LngLat = [-105.0939, 39.4921]; // Waterton Canyon trailhead
  const mercator = toWebMercator(original);
  const roundtrip = toWgs84(mercator);

  assert.ok(Math.abs(roundtrip[0] - original[0]) < 1e-6, "Longitude roundtrip drift");
  assert.ok(Math.abs(roundtrip[1] - original[1]) < 1e-6, "Latitude roundtrip drift");
});

test("geospatial: haversine distance accuracy", () => {
  const p1: LngLat = [-105.0, 40.0];
  const p2: LngLat = [-105.0, 40.01]; // ~1.11 km north
  const dist = haversineMeters(p1, p2);
  assert.ok(dist > 1100 && dist < 1120, `Expected ~1112m, got ${dist}`);
});

test("geospatial: point-to-line orthogonal snapping", () => {
  // Line segment along latitude 40.0 from lng -105.1 to -105.0
  const line: LngLat[] = [
    [-105.1, 40.0],
    [-105.0, 40.0],
  ];

  // Point slightly off-trail to the north at -105.05, 40.0003 (~33 meters north)
  const clickPoint: LngLat = [-105.05, 40.0003];
  const snap = snapPointToLine(clickPoint, line, 50);

  assert.equal(snap.isSnapped, true);
  assert.ok(snap.distanceMeters > 30 && snap.distanceMeters < 38, `Expected ~33m off, got ${snap.distanceMeters}`);
  assert.ok(Math.abs(snap.snapped[0] - (-105.05)) < 1e-4, "Snapped longitude matches orthogonal projection");
  assert.ok(Math.abs(snap.snapped[1] - 40.0) < 1e-5, "Snapped latitude matches trail line");
});

test("geospatial: GPS trace snapping onto trail geometry", () => {
  const trail: LngLat[] = [
    [-105.0, 40.0],
    [-105.01, 40.01],
    [-105.02, 40.02],
  ];

  // Noisy GPS trace with ±15m drift
  const rawGps: LngLat[] = [
    [-105.0001, 40.0001],
    [-105.0099, 40.0102],
    [-105.0202, 40.0198],
  ];

  const snappedTrace = snapGpsTraceToTrail(rawGps, [trail], 35);
  assert.equal(snappedTrace.length, 3);
  // Snapped points should have lower error to the trail than raw noisy GPS
  const rawError = haversineMeters(rawGps[0], trail[0]);
  const snappedError = haversineMeters(snappedTrace[0], trail[0]);
  assert.ok(snappedError < rawError, "Snapped GPS waypoint should align to trail");
});

test("geospatial: dynamic Douglas-Peucker LOD preserves high vertex density on close zooms", () => {
  const switchbackTrail: LngLat[] = [
    [-105.00, 40.00],
    [-105.001, 40.0005],
    [-105.00, 40.001],
    [-105.001, 40.0015],
    [-105.00, 40.002],
  ];

  // At close zoom (z = 15), tolerance is tiny (~0.000018 deg), switchbacks should be fully retained
  const highZoom = simplifyForZoom(switchbackTrail, 15);
  assert.equal(highZoom.length, 5, "Close zoom z=15 must retain all switchback vertices");

  // At regional zoom (z = 9), tolerance is larger, vertices get reduced
  const lowZoom = simplifyForZoom(switchbackTrail, 9);
  assert.ok(lowZoom.length < 5, "Regional zoom z=9 simplifies small switchback noise");
});

test("overpass: builds query with relations, pistes, lifts and technical attributes", () => {
  const bbox: [number, number, number, number] = [39.0, -106.0, 39.5, -105.5];
  const query = buildOverpassQuery(bbox);

  assert.ok(query.includes('route"~"hiking|foot|trail'), "Query contains route relations");
  assert.ok(query.includes("piste:type"), "Query contains ski pistes");
  assert.ok(query.includes("aerialway"), "Query contains ski lifts");
  assert.ok(query.includes("highway\"=\"trailhead"), "Query contains trailheads");
  assert.ok(query.includes("natural\"=\"peak"), "Query contains peaks");
});

test("overpass: normalizes SAC scale and ski piste difficulties", () => {
  assert.equal(normalizeSacScale("mountain_hiking"), "T2 Mountain Hiking");
  assert.equal(normalizeSacScale("demanding_alpine_hiking"), "T5 Demanding Alpine");
  assert.equal(normalizePisteDifficulty("novice"), "novice");
  assert.equal(normalizePisteDifficulty("double_black"), "expert");
  assert.equal(normalizePisteDifficulty("blue"), "easy");
});

test("overpass: parses raw elements into normalized GeoJSON features", () => {
  const sampleElements = [
    { type: "node" as const, id: 101, lat: 39.1, lon: -105.5, tags: { natural: "peak", name: "Mount Silver", ele: "4320" } },
    { type: "node" as const, id: 102, lat: 39.2, lon: -105.6, tags: { highway: "trailhead", name: "Alpine Trailhead" } },
    { type: "node" as const, id: 1, lat: 39.0, lon: -105.0 },
    { type: "node" as const, id: 2, lat: 39.05, lon: -105.05 },
    {
      type: "way" as const,
      id: 201,
      nodes: [1, 2],
      tags: {
        name: "Wilderness Singletrack",
        highway: "path",
        sac_scale: "mountain_hiking",
        surface: "dirt",
      },
    },
    {
      type: "way" as const,
      id: 301,
      nodes: [1, 2],
      tags: {
        name: "Express Quad",
        aerialway: "chair_lift",
      },
    },
    {
      type: "way" as const,
      id: 401,
      nodes: [1, 2],
      tags: {
        name: "Grizzly Bowl",
        "piste:type": "downhill",
        "piste:difficulty": "advanced",
      },
    },
  ];

  const geojson = parseOverpassJson(sampleElements);
  assert.equal(geojson.type, "FeatureCollection");
  assert.equal(geojson.features.length, 5);

  const peak = geojson.features.find((f) => f.properties.poiType === "peak");
  assert.ok(peak, "Extracts peak POI");
  assert.equal(peak.properties.elevationM, 4320);

  const trail = geojson.features.find((f) => f.properties.name === "Wilderness Singletrack");
  assert.ok(trail, "Extracts trail way");
  assert.equal(trail.properties.sacScale, "T2 Mountain Hiking");
  assert.equal(trail.properties.surface, "dirt");

  const piste = geojson.features.find((f) => f.properties.name === "Grizzly Bowl");
  assert.ok(piste, "Extracts ski piste");
  assert.equal(piste.properties.pisteDifficulty, "advanced");

  const lift = geojson.features.find((f) => f.properties.name === "Express Quad");
  assert.ok(lift, "Extracts aerialway lift");
  assert.equal(lift.properties.kind, "lift");
});
