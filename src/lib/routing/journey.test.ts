import test from "node:test";
import assert from "node:assert/strict";
import { metersBetween } from "@/lib/geo/line";
import { buildJourney, greatCircle, journeyLeg, nearestAirport, MAX_POINTS, type Airport, type JourneyPart } from "./journey";
import type { LngLat } from "./graph";

const AIRPORTS: Airport[] = [
  ["SFO", "San Francisco International Airport", "San Francisco", "US", 37.619, -122.375, "L"],
  ["OAK", "Oakland International Airport", "Oakland", "US", 37.721, -122.221, "L"],
  ["NRT", "Narita International Airport", "Tokyo", "JP", 35.765, 140.386, "L"],
  ["HNL", "Daniel K. Inouye International Airport", "Honolulu", "US", 21.318, -157.922, "L"],
];
const straight = (mode: JourneyPart["mode"]) => async (a: LngLat, b: LngLat): Promise<JourneyPart> => ({ mode, coordinates: [a, b], meters: metersBetween(a, b) * 1.2, seconds: 1, label: mode });
const none = async () => null;
/** Fake routers: roads and paths exist only on the same landmass (here: both points in North America). */
const sameLand = (mode: JourneyPart["mode"]) => async (a: LngLat, b: LngLat) => (a[0] < -100 === b[0] < -100 && Math.abs(a[1] - 21.3) > 2 === Math.abs(b[1] - 21.3) > 2 ? straight(mode)(a, b) : null);
const routers = { trail: none, walk: sameLand("walk"), drive: sameLand("drive"), airports: async () => AIRPORTS };

const sf: LngLat = [-122.42, 37.77], la: LngLat = [-118.24, 34.05], tokyo: LngLat = [139.69, 35.69], honolulu: LngLat = [-157.86, 21.31];

test("short legs walk, middle legs drive, long legs fly with ground routes to and from the airports", async () => {
  assert.equal((await journeyLeg(sf, [-122.41, 37.78], "fastest", routers))[0].mode, "walk");
  assert.equal((await journeyLeg(sf, la, "fastest", routers))[0].mode, "drive");
  const toTokyo = await journeyLeg(sf, tokyo, "fastest", routers);
  assert.deepEqual(toTokyo.map((p) => p.mode), ["drive", "flight", "drive"]);
  assert.match(toTokyo[1].label, /SFO → NRT/);
});

test("walking preference walks the whole way on land and flies only across the ocean", async () => {
  assert.deepEqual((await journeyLeg(sf, la, "walk", routers)).map((p) => p.mode), ["walk"]);
  const toHawaii = await journeyLeg(sf, honolulu, "walk", routers);
  assert.deepEqual(toHawaii.map((p) => p.mode), ["walk", "flight", "walk"]);
});

test("up to five points; every leg is routed and the totals add up", async () => {
  const j = await buildJourney([sf, la, honolulu, tokyo, [140.0, 35.8]], "fastest", { routers });
  assert.equal(j.legEndsMeters.length, 4);
  assert.ok(Math.abs(j.meters - j.parts.reduce((t, p) => t + p.meters, 0)) < 1e-6);
  assert.equal(j.legEndsMeters[3], j.meters);
  await assert.rejects(buildJourney(Array.from({ length: MAX_POINTS + 1 }, (_, i) => [-122 + i * 0.01, 37] as LngLat), "fastest", { routers }), /up to 5 points/);
});

test("with no mapped way to an airport, the stretch is a labelled gap, not a fake path", async () => {
  const island: LngLat = [-157.9, 21.4];
  const leg = await journeyLeg(sf, island, "fastest", { ...routers, walk: none, drive: async (a, b) => (b[0] < -150 || a[0] < -150 ? null : straight("drive")(a, b)) });
  assert.deepEqual(leg.map((p) => p.mode), ["drive", "flight", "gap"]);
  assert.match(leg[2].label, /No mapped route/);
});

test("airports and great circles", () => {
  assert.equal(nearestAirport(AIRPORTS, [-122.3, 37.8])?.[0], "OAK");
  // Over the Pacific the arc keeps going west past 180° instead of jumping back across the map.
  const arc = greatCircle([-157.9, 21.3], [140.4, 35.8]);
  assert.ok(arc.every((p, i) => i === 0 || Math.abs(p[0] - arc[i - 1][0]) < 30));
  assert.ok(arc[arc.length - 1][0] < -180);
});
