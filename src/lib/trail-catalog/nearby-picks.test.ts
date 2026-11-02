import { test } from "node:test";
import assert from "node:assert/strict";
import { nearbyQualityScore, pickNearbyTrails } from "./nearby-picks";
import type { CatalogTrail } from "./types";
import { trailDifficulty } from "../trail-difficulty";

let n = 0;
const trail = (over: Partial<CatalogTrail>): CatalogTrail => ({ id: `t${++n}`, name: `Trail ${n} Trail`, country: "US", region: "California", kind: "segment", source: "osm", miles: 3, latitude: 34, longitude: -118, difficulty: "moderate", dogs: null, geometryShard: "1_1", bounds: [0, 0, 1, 1], ...over } as CatalogTrail);

test("quality beats raw distance", () => {
  const near = trail({ name: "Burton Trail — Angeles National Forest", originalName: "Burton", latitude: 34.001 });
  const better = trail({ name: "Eaton Canyon Trail", manager: "Los Angeles County Department of Parks and Recreation", wiki: { qid: "Q1", image: { url: "x", pageUrl: "x", license: null, licenseUrl: null, artist: null } }, latitude: 34.05 });
  const origin = { lat: 34, lng: -118, exact: true };
  assert.ok(nearbyQualityScore(better, origin) > nearbyQualityScore(near, origin));
  assert.equal(pickNearbyTrails([near, better], { origin, count: 1 })[0].trail.id, better.id);
});

test("four cards mix difficulties: one easy, two moderate, one hard", () => {
  const easy = () => trail({ miles: 1, gainFt: 50 });
  const moderate = () => trail({ miles: 5, gainFt: 900 });
  const hard = () => trail({ miles: 11, gainFt: 3200 });
  const picks = pickNearbyTrails([moderate(), moderate(), moderate(), hard(), hard(), easy(), easy()]);
  assert.deepEqual(picks.map((p) => trailDifficulty(p.trail)).map((d) => (d === "expert" ? "hard" : d)), ["easy", "moderate", "moderate", "hard"]);
});

test("missing difficulties are filled with the best remaining trails", () => {
  const easy = () => trail({ miles: 1, gainFt: 50 });
  const picks = pickNearbyTrails([easy(), easy(), easy(), trail({ miles: 5, gainFt: 900 }), trail({ miles: 5, gainFt: 800 })]);
  assert.equal(picks.length, 4);
});

test("every card has a distinct, true reason", () => {
  const picks = pickNearbyTrails([
    trail({ gainFt: 80, miles: 1.2 }),
    trail({ gainFt: 900, miles: 5, routeType: "loop" }),
    trail({ gainFt: 700, miles: 4 }),
    trail({ gainFt: 3200, maxElevFt: 7000, miles: 11 }),
  ], { origin: { lat: 34, lng: -118, exact: false } });
  const reasons = picks.map((p) => p.reason);
  assert.equal(new Set(reasons).size, 4, reasons.join(", "));
  assert.equal(picks[0].reason, "Shortest climb");
  assert.equal(picks[3].reason, "Biggest climb nearby");
  assert.ok(!reasons.includes("Closest to you"), "no distance claim when the location is a guess");
});
