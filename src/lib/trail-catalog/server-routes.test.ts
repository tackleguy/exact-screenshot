import test from "node:test";
import assert from "node:assert/strict";
import {
  catalogFeaturesInView,
  catalogRoutingNetwork,
  catalogThruHikeLines,
  catalogTrailFeatures,
  exploreCatalogClusters,
  getCatalogTrail,
  getCatalogTrailSummary,
  isCatalogTrailId,
  nearbyCatalogTrails,
  searchCatalog,
  snapToCatalogTrail,
} from "./server";

test("server catalog resolves curated peaks, thru-hike sections, world countries, and map/routing helpers", async () => {
  assert.equal(isCatalogTrailId("summit-everest"), true);
  assert.equal(isCatalogTrailId("../../etc/passwd"), false);

  const everest = await getCatalogTrail("summit-everest");
  assert.ok(everest);
  assert.equal(everest.trail.id, "summit-everest");

  const summary = await getCatalogTrailSummary("summit-everest");
  assert.ok(summary);
  assert.equal(summary.trail.id, "summit-everest");

  const fourteeners = await searchCatalog({ collection: "14ers", limit: 10 });
  assert.ok(fourteeners.total >= 20);
  assert.ok(fourteeners.trails.every((t) => t.peakCategory === "14er" || t.tags?.includes("14er")));

  const everestSearch = await searchCatalog({ q: "Mount Everest", limit: 5 });
  assert.ok(everestSearch.trails.some((t) => t.id === "summit-everest"));

  const gbSearch = await searchCatalog({ country: "GB", q: "West Highland Way", limit: 5 });
  assert.ok(gbSearch.total >= 1);

  const clusters = await exploreCatalogClusters({ activity: "hike", bbox: [-130, 24, -65, 50] }, 4);
  assert.ok(clusters.total > 50_000);
  assert.ok(clusters.clusters.length > 5);
  assert.equal(clusters.clusters[0].length, 8);

  const thru = await catalogThruHikeLines();
  assert.equal(thru.type, "FeatureCollection");
  assert.ok(thru.features.length >= 1);

  // Yosemite Valley routing network & features
  const yosemiteBox: [number, number, number, number] = [-119.62, 37.71, -119.52, 37.76];
  const net = await catalogRoutingNetwork(yosemiteBox);
  assert.equal(net.type, "FeatureCollection");
  assert.ok(net.features.length >= 10);

  const sampleFeature = net.features[0];
  const sampleId = String(sampleFeature.properties?.id);
  const encodedDetail = await getCatalogTrail(encodeURIComponent(sampleId));
  assert.ok(encodedDetail);
  assert.equal(encodedDetail.trail.id, sampleId);

  const near = await nearbyCatalogTrails(sampleId);
  assert.ok(near && near.length > 0);

  const firstCoord = (sampleFeature.geometry as GeoJSON.MultiLineString).coordinates[0][0];
  const snapped = await snapToCatalogTrail(firstCoord[1], firstCoord[0], 100);
  assert.equal(snapped.isSnapped, true);

  const viewFeatures = await catalogFeaturesInView(yosemiteBox, new Set());
  if (viewFeatures !== null) {
    assert.ok(viewFeatures.features.length > 0);
    assert.equal(viewFeatures.toGeoJson().type, "FeatureCollection");
  }

  const trailFeats = await catalogTrailFeatures(encodedDetail.trail.id, encodedDetail.lines);
  if (trailFeats !== null) {
    assert.ok(Array.isArray(trailFeats));
  }
});
