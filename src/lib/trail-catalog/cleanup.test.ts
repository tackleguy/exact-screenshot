import test from "node:test";
import assert from "node:assert/strict";
import { cleanTrailName, dedupeKey, isJunkSegment, listScore, overlapShare, realHike, routeTypeFromLines } from "./cleanup";
import type { CatalogTrail } from "./types";

test("names lose source ids and glued review flags; PCT is spelled out; all-caps names are title-cased", () => {
  assert.deepEqual(cleanTrailName("Napoleon Canyon (32092)"), { name: "Napoleon Canyon", needsReview: false });
  assert.deepEqual(cleanTrailName("Pct: StanislausNeeds review"), { name: "PCT: Stanislaus", needsReview: true });
  assert.equal(cleanTrailName("BEAR LAKE TRAIL").name, "Bear Lake Trail");
  assert.equal(cleanTrailName("sentier du mont").name, "Sentier du Mont");
  assert.equal(cleanTrailName("McKenzie Pass").name, "McKenzie Pass");
  assert.equal(cleanTrailName("Highway 1 (CA)").name, "Highway 1 (CA)");
  assert.equal(cleanTrailName("Bull Creek Trail (85)").name, "Bull Creek Trail");
  assert.equal(cleanTrailName("Hude (57) - Hude (84)").name, "Hude");
  assert.equal(cleanTrailName("Diepholz (42) - Vechta (79)").name, "Diepholz - Vechta");
  assert.equal(cleanTrailName("(46) Freudenberg - (58) Freudenberg").name, "Freudenberg");
  assert.equal(cleanTrailName("(15) - (38)").name, "Trail 15–38");
  assert.equal(cleanTrailName("233 Trailhead: (936) 344-6205").name, "233 Trailhead");
});

test("junk segments: driveway/road/parking/sidewalk names, and stubs under 0.15 mi unless part of a route or a loop", () => {
  const base = { kind: "segment", miles: 2, partOfRoute: undefined, routeType: "point-to-point" } as const;
  assert.ok(isJunkSegment({ ...base, name: "Driveway" }));
  assert.ok(isJunkSegment({ ...base, name: "Parking Lot" }));
  assert.ok(isJunkSegment({ ...base, name: "Spur", miles: 0.1 }));
  assert.ok(!isJunkSegment({ ...base, name: "Spur", miles: 0.1, routeType: "loop" }));
  assert.ok(!isJunkSegment({ ...base, name: "Stage 3", miles: 0.1, partOfRoute: { id: "r", name: "R", totalMiles: 9 } }));
  assert.ok(!isJunkSegment({ ...base, name: "Mist Trail" }));
});

test("route type comes from the line: loop, out & back, point to point, or a trail segment", () => {
  const east = (n: number, y = 37) => Array.from({ length: n }, (_, i) => [-119 + i * 0.001, y] as [number, number]);
  assert.equal(routeTypeFromLines([east(30)]), "point-to-point");
  const square: [number, number][] = [[-119, 37], [-118.99, 37], [-118.99, 37.01], [-119, 37.01], [-119, 37.0005]];
  assert.equal(routeTypeFromLines([square]), "loop");
  const out = east(40);
  assert.equal(routeTypeFromLines([[...out, ...[...out].reverse().slice(1).map(([x, y]) => [x, y + 0.0001] as [number, number])]]), "out-and-back");
  assert.equal(routeTypeFromLines([east(10), east(10, 37.5)]), "segment");
});

test("near-duplicates: names match without park, trail and loop words; overlap is measured on the lines", () => {
  const yv = { name: "Yosemite Valley Loop Trail", park: "Yosemite National Park" } as CatalogTrail;
  const v = { name: "Valley Loop Trail", park: "Yosemite National Park" } as CatalogTrail;
  assert.equal(dedupeKey(yv), dedupeKey(v));
  const line: [number, number][] = Array.from({ length: 50 }, (_, i) => [-119.6 + i * 0.0005, 37.74]);
  assert.ok(overlapShare([line.slice(0, 25)], [line]) > 0.9);
  assert.ok(overlapShare([line.map(([x, y]) => [x, y + 0.01] as [number, number])], [line]) < 0.1);
});

test("best-documented order puts real hikes ahead of 0.1 mi stubs", () => {
  const stub = { name: "Connector", miles: 0.1, tier: "verified", gainFt: 20, qualityScore: 90, kind: "segment" } as CatalogTrail;
  const hike = { name: "Ridge Trail", miles: 4, tier: "mapped", qualityScore: 10, kind: "segment" } as CatalogTrail;
  assert.ok(realHike(hike) && !realHike(stub));
  assert.ok(listScore(hike) > listScore({ ...stub, tier: "mapped" }));
});
