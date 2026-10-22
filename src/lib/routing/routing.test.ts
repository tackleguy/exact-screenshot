import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph, type LngLat, type NetworkTrail } from "./graph";
import { routeThrough, RouteError } from "./route";
import { featuresAlong, type HikeFeature } from "./features";
import { splitDays } from "./days";
import { routeGpx } from "./gpx";

// Points given in meters east/north of a Sierra origin.
const O: LngLat = [-119.5, 37.7];
const KX = Math.cos((O[1] * Math.PI) / 180) * 111_320, KY = 110_540;
const m = (x: number, y: number): LngLat => [O[0] + x / KX, O[1] + y / KY];
const line = (...pts: [number, number][]) => pts.map(([x, y]) => m(x, y));
const trail = (id: string, lines: LngLat[][], quality = 50, tier = "verified"): NetworkTrail => ({ id, name: id, quality, tier, lines });

test("routes the shortest way along trails and lists the trails used with switch miles", () => {
  // A: west–east 0→4000; B: north from A's middle (shares the vertex at 2000,0) up to 2000,3000.
  const g = buildGraph([trail("A", [line([0, 0], [2000, 0], [4000, 0])]), trail("B", [line([2000, 0], [2000, 3000])])]);
  const r = routeThrough(g, [m(0, 0), m(2000, 3000)]);
  assert.ok(Math.abs(r.meters - 5000) < 20, `meters ${r.meters}`);
  assert.deepEqual(r.trails.map((t) => t.id), ["A", "B"]);
  assert.ok(Math.abs(r.trails[0].toMile - 2000 / 1609.344) < 0.02);
  assert.equal(r.usesConnectors, false);
});

test("splits lines where they cross without a shared vertex", () => {
  const g = buildGraph([trail("A", [line([0, 0], [4000, 0])]), trail("B", [line([2000, -1500], [2000, 1500])])]);
  const r = routeThrough(g, [m(0, 0), m(2000, 1500)]);
  assert.ok(Math.abs(r.meters - 3500) < 20, `meters ${r.meters}`);
});

test("joins a trail end that stops just short of another trail (within 30 m)", () => {
  const g = buildGraph([trail("A", [line([0, 0], [4000, 0])]), trail("B", [line([1000, 20], [1000, 2000])])]);
  const r = routeThrough(g, [m(0, 0), m(1000, 2000)]);
  assert.ok(Math.abs(r.meters - 3000) < 30, `meters ${r.meters}`);
});

test("prefers a higher-quality verified trail over a slightly shorter low-quality one", () => {
  const good = trail("Good", [line([0, 0], [1000, 600], [2000, 0])], 100, "verified");
  const poor = trail("Poor", [line([0, 0], [1000, 400], [2000, 0])], 0, "mapped");
  const r = routeThrough(buildGraph([good, poor]), [m(0, 0), m(2000, 0)]);
  assert.deepEqual(r.trails.map((t) => t.id), ["Good"]);
});

test("snaps tapped points to the nearest trail and reports how far off they were", () => {
  const g = buildGraph([trail("A", [line([0, 0], [3000, 0])])]);
  const r = routeThrough(g, [m(500, 120), m(2500, -80)]);
  assert.equal(r.snapped[0].offTrailMeters, 120);
  assert.equal(r.snapped[1].offTrailMeters, 80);
  assert.ok(Math.abs(r.meters - 2000) < 10);
  assert.throws(() => routeThrough(g, [m(0, 5000), m(3000, 0)]), RouteError);
});

test("never crosses a gap unless connectors are allowed, and labels connectors", () => {
  const trails = [trail("A", [line([0, 0], [1000, 0])]), trail("B", [line([1200, 0], [2500, 0])])];
  assert.throws(() => routeThrough(buildGraph(trails), [m(0, 0), m(2500, 0)]), /No mapped trail connects/);
  const r = routeThrough(buildGraph(trails, { connectors: true }), [m(0, 0), m(2500, 0)]);
  assert.equal(r.usesConnectors, true);
  assert.deepEqual(r.trails.map((t) => t.id), ["A", null, "B"]);
  assert.equal(r.trails[1].connector, true);
});

test("routes through waypoints in order and records leg ends", () => {
  const g = buildGraph([trail("A", [line([0, 0], [4000, 0])])]);
  const r = routeThrough(g, [m(0, 0), m(3000, 0), m(1000, 0)]);
  assert.ok(Math.abs(r.meters - 5000) < 10);
  assert.equal(r.legEndsMile.length, 2);
});

test("places features at their mile along the route within the distance limits", () => {
  const route = line([0, 0], [8000, 0]);
  const f = (id: string, type: string, x: number, y: number): HikeFeature => { const [lon, lat] = m(x, y); return { id, type, name: "", lat, lon, source: "OpenStreetMap" }; };
  const list = featuresAlong(route, [f("w1", "spring", 3218.7, 150), f("w2", "spring", 4000, 260), f("c1", "campsite", 6437, 280), f("x", "peak", 100, 900)]);
  assert.deepEqual(list.map((x) => x.id), ["w1", "c1"]);
  assert.ok(Math.abs(list[0].mile - 2) < 0.01);
  assert.equal(list[0].name, "Spring");
  assert.ok(Math.abs(list[0].offRouteFt - 492) < 3);
});

test("splits days at the campsite nearest each day's target", () => {
  const camp = (mile: number, id: string) => ({ id, type: "campsite", name: id, lat: 0, lon: 0, mile, offRouteFt: 0, source: "OpenStreetMap" });
  const days = splitDays(30, [camp(9, "a"), camp(11.5, "b"), camp(19, "c"), camp(25, "d")], 10);
  assert.deepEqual(days.map((d) => d.stop?.id ?? null), ["a", "c", null]);
  assert.equal(days[2].toMile, 30);
  const none = splitDays(30, [], 10);
  assert.deepEqual(none.map((d) => d.toMile), [10, 20, 30]);
  assert.equal(none[0].stop, null);
});

test("GPX has a waypoint per feature and escapes names", () => {
  const gpx = routeGpx("A & B", line([0, 0], [100, 0]), [{ id: "1", type: "spring", name: "Joe's <spring>", lat: 37.7, lon: -119.5, mile: 0.1, offRouteFt: 0, source: "OpenStreetMap" }]);
  assert.match(gpx, /<wpt lat="37.700000" lon="-119.500000"><name>Joe&apos;s &lt;spring&gt;<\/name>/);
  assert.match(gpx, /<name>A &amp; B<\/name>/);
  assert.equal((gpx.match(/<trkpt/g) ?? []).length, 2);
});
