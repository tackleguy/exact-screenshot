import test from "node:test";
import assert from "node:assert/strict";
import { Route } from "@/lib/geo/line";
import { pointsToGeoJSON } from "@/lib/gps";
import { toGpsPoints, TrackRecorder, type Fix } from "@/lib/gps-track";
import { estimatedRanges, routeEstimates, routeRuns } from "@/lib/route-provenance";
import type { GeoLineString } from "@/lib/types";

const north = (i: number, meters: number) => 37 + (i * meters) / 111_000;
const walk = (i: number, extra: Partial<Fix> = {}): Fix => ({ lat: north(i, 10), lng: -119, altitudeM: null, accuracyM: 5, time: i * 10_000, ...extra });
/** A straight trail north for 1 km, climbing 1 ft every 10 m (100 ft in all). */
const line: [number, number][] = Array.from({ length: 101 }, (_, i) => [-119, north(i, 10)]);
const profile: [number, number][] = Array.from({ length: 101 }, (_, i) => [(i * 10) / 1609.344, 4000 + i]);
const trail = () => ({ route: new Route([line]), profile });
/** What the recorder hands to the activity save: the line built from its points and its estimated climb. */
const saved = (r: TrackRecorder) => pointsToGeoJSON(toGpsPoints(r.points), r.estimatedGainFt);

/** 20 fixes on the trail, the page in the background for 10 minutes, then 20 more fixes 400 m further on. */
function backgroundWalk(r: TrackRecorder) {
  for (let i = 0; i <= 20; i++) r.push(walk(i));
  const resume = 20 * 10_000 + 10 * 60_000;
  for (let k = 0; k <= 20; k++) r.push(walk(60 + k, { time: resume + k * 10_000 }));
}

test("an ordinary recording saves exactly as before: a plain LineString with no estimates", () => {
  const r = new TrackRecorder("hike", trail());
  for (let i = 0; i <= 40; i++) r.push(walk(i));
  const geo = saved(r);
  assert.deepEqual(Object.keys(geo).sort(), ["coordinates", "type"]);
  assert.equal(r.estimatedDistanceM, 0);
  assert.equal(r.estimatedGainFt, 0);
  assert.equal(routeEstimates(geo), null);
  assert.equal(toGpsPoints(r.points).some((p) => "estimated" in p), false);
});

test("a background GPS interruption on the trail is saved as an estimated stretch with its distance and climb", () => {
  const r = new TrackRecorder("hike", trail());
  backgroundWalk(r);
  assert.equal(r.gaps.length, 1);
  assert.equal(r.gaps[0].bridged, "trail");
  // The filled points and the first real fix after the gap are marked; measured points around them are not.
  const points = toGpsPoints(r.points);
  const marked = points.map((p, i) => (p.estimated ? i : -1)).filter((i) => i >= 0);
  assert.ok(marked.length >= 10);
  assert.deepEqual(marked, Array.from({ length: marked.length }, (_, k) => marked[0] + k), "one contiguous run");
  assert.ok(points.slice(0, marked[0]).every((p) => !p.estimated));
  assert.ok(points.slice(marked[marked.length - 1] + 1).every((p) => !p.estimated));

  const geo = saved(r);
  const e = routeEstimates(geo);
  assert.ok(e);
  assert.deepEqual(e.ranges, [[marked[0] - 1, marked[marked.length - 1], "trail"]]);
  // About 400 m of the ~600 m walked, and about 40 of the 60 ft climbed, were estimated.
  assert.ok(Math.abs(e.meters - 400) < 25, `${e.meters}`);
  assert.ok(Math.abs(e.meters - r.estimatedDistanceM) < 5, `${e.meters} vs ${r.estimatedDistanceM}`);
  assert.ok(e.gainFt >= 30 && e.gainFt <= 45, `${e.gainFt}`);
  assert.ok(e.gainFt < r.gainFt);
  assert.ok(r.estimatedDistanceM < r.totalDistanceM);
});

test("a gap away from the trail is saved as a direct join, not as a measured line", () => {
  const r = new TrackRecorder("hike", trail());
  for (let i = 0; i <= 5; i++) r.push(walk(i));
  // Back 10 minutes later, 300 m east of the trail.
  r.push({ lat: north(5, 10), lng: -119 + 300 / 88_000, altitudeM: null, accuracyM: 5, time: 50_000 + 10 * 60_000 });
  for (let k = 1; k <= 5; k++) r.push({ lat: north(5 + k, 10), lng: -119 + 300 / 88_000, altitudeM: null, accuracyM: 5, time: 50_000 + 10 * 60_000 + k * 10_000 });
  const e = routeEstimates(saved(r));
  assert.ok(e);
  assert.equal(e.ranges.length, 1);
  assert.equal(e.ranges[0][2], "direct");
  assert.equal(e.ranges[0][1] - e.ranges[0][0], 1, "just the one straight step");
  assert.ok(e.meters > 100);
});

test("a recording resumed from its saved fixes (crash, refresh) keeps the same estimates", () => {
  const first = new TrackRecorder("hike", trail());
  backgroundWalk(first);
  // What track-store saves and the recorder replays on "Resume recording?".
  const stored = JSON.parse(JSON.stringify(first.accepted)) as Fix[];
  const resumed = new TrackRecorder("hike", trail());
  for (const f of stored) resumed.push(f);
  assert.deepEqual(toGpsPoints(resumed.points).map((p) => p.estimated ?? null), toGpsPoints(first.points).map((p) => p.estimated ?? null));
  assert.ok(Math.abs(resumed.estimatedDistanceM - first.estimatedDistanceM) < 1e-6);
  assert.equal(resumed.estimatedGainFt, first.estimatedGainFt);
});

test("estimates survive being stored as JSON (the activities table keeps route_geojson as JSONB)", () => {
  const r = new TrackRecorder("hike", trail());
  backgroundWalk(r);
  const geo = saved(r);
  assert.deepEqual(routeEstimates(JSON.parse(JSON.stringify(geo)) as GeoLineString), routeEstimates(geo));
});

test("previously saved activities, manual logs and malformed records show as fully measured", () => {
  const old: GeoLineString = { type: "LineString", coordinates: [[-119, 37], [-119, 37.001], [-119, 37.002]] };
  assert.equal(routeEstimates(old), null);
  assert.equal(routeEstimates(null), null);
  assert.deepEqual(routeRuns(old), [{ estimated: null, coordinates: [[-119, 37], [-119, 37.001], [-119, 37.002]] }]);
  const bad = (estimated: unknown) => routeEstimates({ ...old, estimated } as unknown as GeoLineString);
  assert.equal(bad("yes"), null);
  assert.equal(bad({ version: 2, ranges: [[0, 1, "trail"]], meters: 5, gainFt: 0 }), null);
  assert.equal(bad({ version: 1, ranges: [[0, 9, "trail"]], meters: 5, gainFt: 0 }), null, "range past the end");
  assert.equal(bad({ version: 1, ranges: [[1, 1, "trail"]], meters: 5, gainFt: 0 }), null, "empty range");
  assert.equal(bad({ version: 1, ranges: [[0, 1, "guess"]], meters: 5, gainFt: 0 }), null, "unknown kind");
  assert.deepEqual(bad({ version: 1, ranges: [[0, 1, "trail"]], meters: -3, gainFt: "x" }), { version: 1, ranges: [[0, 1, "trail"]], meters: 0, gainFt: 0 });
});

test("routes split into measured and estimated runs that share their boundary points", () => {
  const coords: [number, number][] = Array.from({ length: 8 }, (_, i) => [-119, 37 + i * 0.001]);
  const ranges = estimatedRanges([{}, {}, {}, { estimated: "trail" }, { estimated: "trail" }, {}, { estimated: "direct" }, {}]);
  assert.deepEqual(ranges, [[2, 4, "trail"], [5, 6, "direct"]]);
  const runs = routeRuns({ type: "LineString", coordinates: coords, estimated: { version: 1, ranges, meters: 1, gainFt: 0 } });
  assert.deepEqual(runs.map((r) => [r.estimated, r.coordinates.length]), [[null, 3], ["trail", 3], [null, 2], ["direct", 2], [null, 2]]);
  for (let i = 1; i < runs.length; i++) assert.deepEqual(runs[i].coordinates[0], runs[i - 1].coordinates[runs[i - 1].coordinates.length - 1]);
});
