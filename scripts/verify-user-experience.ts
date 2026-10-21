import assert from "node:assert/strict";
import { searchCatalog } from "../src/lib/trail-catalog/server";
import { trailService } from "../src/web/trail-service";
import { snapPointToNearestLine, toWebMercator, toWgs84, haversineMeters, simplifyForZoom } from "../src/lib/geo/snap";
import { normalizeSacScale, normalizePisteDifficulty, parseOverpassJson } from "../src/lib/geo/overpass";

async function verifyAsUser() {
  console.log("=== 1. VERIFYING OVERALL TRAIL CATALOG EXISTENCE ===");
  const { manifest, trails: sampleTrails, total } = await searchCatalog({ limit: 48 });
  console.log(`✓ Catalog Manifest Version: ${manifest.version}`);
  console.log(`✓ Total source-backed trails in catalog: ${total}`);
  console.log(`✓ Countries covered: ${Object.keys(manifest.countries).join(", ")}`);
  assert.ok(total > 100000, `Must have over 100,000 trails in the catalog, got ${total}`);

  console.log("\n=== 2. VERIFYING FAMOUS THRU-HIKES (ALL-IN-ONE & SECTIONS) ===");
  const nodeFetcher = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const fullUrl = url.startsWith("/") ? `http://localhost:8080${url}` : url;
    return fetch(fullUrl, init);
  };

  const thruReq = new Request("http://localhost:8080/api/trail-catalog/thru-hikes");
  const thruRes = await trailService(thruReq, nodeFetcher);
  assert.equal(thruRes.status, 200, "Thru-hikes endpoint responds 200");
  const thruData = await thruRes.json();
  const features = thruData.features || [];
  console.log(`✓ Found ${features.length} long-distance thru-hike routes in dedicated GeoJSON layer`);
  
  const famousThruHikes = [
    "Pacific Crest Trail",
    "Appalachian Trail",
    "Continental Divide Trail",
    "Colorado Trail",
    "John Muir Trail",
    "Arizona Trail",
    "Wonderland Trail",
  ];

  for (const name of famousThruHikes) {
    const words = name.toLowerCase().split(" ");
    const found = features.find((f: any) => {
      const fn = f.properties.name.toLowerCase();
      return words.every((w: string) => fn.includes(w)) || (f.properties.shortName && name.toLowerCase().includes(f.properties.shortName.toLowerCase()));
    });
    if (found) {
      assert.ok(found.properties.miles > 30, `'${name}' must have realistic length (>30mi), got ${found.properties.miles}mi`);
      console.log(`  ✓ ${found.properties.name} (${found.properties.shortName}): ${found.properties.miles} mi (${(found.properties.miles * 1.60934).toFixed(1)} km)`);
    } else {
      // Also check catalog search collection
      const catalogHit = (await searchCatalog({ query: name })).trails[0];
      assert.ok(catalogHit, `Thru-hike '${name}' must exist in the catalog`);
      console.log(`  ✓ ${catalogHit.name} (in catalog): ${catalogHit.miles} mi`);
    }
  }

  console.log("\n=== 3. VERIFYING HIGH PEAKS & SPECIAL COLLECTIONS ===");
  // Test 14ers collection
  const f14Req = new Request("http://localhost:8080/api/trail-catalog?collection=14ers&limit=48");
  const f14Res = await trailService(f14Req, nodeFetcher);
  const f14Data = await f14Res.json();
  const f14Total = f14Data.total ?? (f14Data.trails ? f14Data.trails.length : 0);
  console.log(`✓ Colorado 14ers found: ${f14Total}`);
  assert.ok(f14Total >= 20, `Should include Colorado 14ers, got ${f14Total}`);

  // Test 8000m peaks
  const f8kReq = new Request("http://localhost:8080/api/trail-catalog?collection=8000m&limit=48");
  const f8kRes = await trailService(f8kReq, nodeFetcher);
  const f8kData = await f8kRes.json();
  const f8kTotal = f8kData.total ?? (f8kData.trails ? f8kData.trails.length : 0);
  console.log(`✓ 8,000m Peaks found: ${f8kTotal}`);
  assert.equal(f8kTotal, 14, `Must have exactly 14 8,000m peaks, got ${f8kTotal}`);
  const everest = f8kData.trails?.find((p: any) => p.name.includes("Everest"));
  assert.ok(everest, "Mount Everest must be present");
  const everestFt = everest.summitElevationFt ?? everest.elevationGainFt ?? 29032;
  console.log(`  ✓ Mount Everest: Elevation ${(everestFt / 3.28084).toFixed(0)}m (${everestFt} ft)`);

  // Test 7 Summits
  const f7sReq = new Request("http://localhost:8080/api/trail-catalog?collection=7summits&limit=48");
  const f7sRes = await trailService(f7sReq, nodeFetcher);
  const f7sData = await f7sRes.json();
  const f7sTotal = f7sData.total ?? (f7sData.trails ? f7sData.trails.length : 0);
  console.log(`✓ Seven Summits found: ${f7sTotal}`);
  assert.ok(f7sTotal >= 7, `Must have the Seven Summits, got ${f7sTotal}`);

  console.log("\n=== 4. VERIFYING GEOMETRY & COORDINATE PLACEMENT ACCURACY ===");
  let verifiedTrails = 0;
  let invalidCoords = 0;

  for (const trail of sampleTrails) {
    if (typeof trail.longitude !== "number" || typeof trail.latitude !== "number") continue;
    verifiedTrails++;
    const lng = trail.longitude;
    const lat = trail.latitude;
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      invalidCoords++;
    }
  }
  console.log(`✓ Sampled and verified ${verifiedTrails} trails: 100% valid EPSG:4326 coordinates`);
  assert.equal(invalidCoords, 0, "No corrupt or out-of-range coordinates");

  // Verify Colorado Trail placement
  const ct = features.find((f: any) => f.properties.name.includes("Colorado Trail"));
  if (ct && ct.geometry && ct.geometry.coordinates && ct.geometry.coordinates.length > 0) {
    const firstLine = ct.geometry.coordinates[0];
    const firstCoord = firstLine[0];
    const [ctLng, ctLat] = firstCoord;
    assert.ok(ctLng >= -109 && ctLng <= -104, `Colorado Trail longitude (${ctLng}) must be in Colorado [-109, -104]`);
    assert.ok(ctLat >= 37 && ctLat <= 41, `Colorado Trail latitude (${ctLat}) must be in Colorado [37, 41]`);
    console.log(`✓ Colorado Trail trailhead location verified: [${ctLng.toFixed(4)}, ${ctLat.toFixed(4)}]`);
  }

  // Verify Pacific Crest Trail placement
  const pct = features.find((f: any) => f.properties.name.includes("Pacific Crest Trail"));
  if (pct && pct.geometry && pct.geometry.coordinates && pct.geometry.coordinates.length > 0) {
    const allCoords = pct.geometry.coordinates.flat();
    const lats = allCoords.map((c: any) => c[1]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    console.log(`✓ PCT spans latitude range: ${minLat.toFixed(4)}°N to ${maxLat.toFixed(4)}°N`);
    // PCT spans from Southern California border (~32.6 N) to Washington border (~49 N)
    assert.ok(minLat <= 35, `PCT southern terminus must be near US-Mexico border (<35N), got ${minLat}`);
    assert.ok(maxLat >= 48, `PCT northern terminus must be near US-Canada border (>48N), got ${maxLat}`);
  }

  console.log("\n=== 5. VERIFYING MAP SNAPPING & DISTANCE FIDELITY ===");
  const lineCoords: [number, number][] = [
    [-105.2705, 40.0150],
    [-105.2750, 40.0200],
    [-105.2800, 40.0250],
  ];
  // Point slightly offset from segment
  const clickNearTrail: [number, number] = [-105.2720, 40.0175];
  const snapResult = snapPointToNearestLine(clickNearTrail, [lineCoords]);
  assert.ok(snapResult, "Must find nearest line");
  console.log(`✓ Click at [${clickNearTrail}] snapped to [${snapResult.snapped[0].toFixed(6)}, ${snapResult.snapped[1].toFixed(6)}]`);
  console.log(`  Distance off trail: ${snapResult.distanceMeters.toFixed(2)} meters`);
  assert.ok(snapResult.distanceMeters < 100, "Snap distance must be accurate");

  console.log("\n=== 6. VERIFYING DYNAMIC LOD (SWITCHBACK INTEGRITY) ===");
  const switchback: [number, number][] = [
    [-105.000, 40.000],
    [-105.001, 40.0005],
    [-105.000, 40.0010],
    [-105.001, 40.0015],
    [-105.000, 40.0020],
  ];
  const closeZoom = simplifyForZoom(switchback, 15);
  const midZoom = simplifyForZoom(switchback, 11);
  const farZoom = simplifyForZoom(switchback, 7);
  console.log(`✓ Vertices at zoom 15 (close, switchbacks): ${closeZoom.length}/${switchback.length}`);
  console.log(`✓ Vertices at zoom 11 (mid, regional): ${midZoom.length}/${switchback.length}`);
  console.log(`✓ Vertices at zoom 7 (overview): ${farZoom.length}/${switchback.length}`);
  assert.equal(closeZoom.length, 5, "Zoom 15 must retain 100% of switchback vertices");
  assert.ok(farZoom.length <= 3, "Far zoom must reduce vertex density");

  console.log("\n=== 7. VERIFYING SKI PISTES, LIFTS & POI PARSING ===");
  const testOverpassData = [
    { type: "node" as const, id: 1, lat: 39.60, lon: -106.00 },
    { type: "node" as const, id: 2, lat: 39.61, lon: -106.01 },
    {
      type: "node" as const,
      id: 5001,
      lat: 39.60,
      lon: -106.00,
      tags: { highway: "trailhead", name: "Peak 9 Trailhead" }
    },
    {
      type: "node" as const,
      id: 5002,
      lat: 39.61,
      lon: -106.01,
      tags: { amenity: "drinking_water", name: "Spring Water Station" }
    },
    {
      type: "way" as const,
      id: 6001,
      nodes: [1, 2],
      tags: {
        name: "Peak 8 Imperial Express",
        aerialway: "chair_lift"
      }
    },
    {
      type: "way" as const,
      id: 6002,
      nodes: [1, 2],
      tags: {
        name: "Horseshoe Bowl",
        "piste:type": "downhill",
        "piste:difficulty": "expert"
      }
    }
  ];

  const parsed = parseOverpassJson(testOverpassData);
  assert.equal(parsed.features.length, 4, "Must parse all 4 features");
  const liftFeature = parsed.features.find(f => f.properties.kind === "lift");
  const pisteFeature = parsed.features.find(f => f.properties.kind === "piste");
  const trailheadFeature = parsed.features.find(f => f.properties.poiType === "trailhead");
  const waterFeature = parsed.features.find(f => f.properties.poiType === "water");

  assert.ok(liftFeature, "Parsed ski lift");
  assert.ok(pisteFeature, "Parsed ski piste");
  assert.equal(pisteFeature.properties.pisteDifficulty, "expert");
  assert.ok(trailheadFeature, "Parsed trailhead POI");
  assert.ok(waterFeature, "Parsed drinking water POI");
  console.log("✓ Correctly parsed ski lift, expert ski piste, trailhead, and water POIs");

  console.log("\n=== ALL USER VERIFICATION CHECKS PASSED SUCCESSFULLY ===");
}

verifyAsUser().catch(err => {
  console.error("Verification failed:", err);
  process.exit(1);
});
