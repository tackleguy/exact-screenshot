import test from "node:test";
import assert from "node:assert/strict";
import { MILE_METERS, Route, chainLines, segmentIntersection } from "../geo/line";
import type { LngLat } from "../geo/tiles";
import { climb } from "./elevation";
import { planTownDays, townChecklist } from "./town-days";
import { townsNear, type Town, type TownServices } from "./towns";
import { tripGpx, tripPacketHtml, waterCsv, type TripBundle } from "./packet";
import type { CatalogTrail } from "../trail-catalog/types";

// ~1 mile north per 0.01447° of latitude.
const north = (fromMi: number, toMi: number, lng = -105): LngLat[] => [[lng, 40 + fromMi * 0.014472], [lng, 40 + toMi * 0.014472]];

test("route measures along the line and places nearby points at their mile", () => {
  const route = new Route([north(0, 10)]);
  assert.ok(Math.abs(route.meters / MILE_METERS - 10) < 0.05);
  const at = route.locate([-104.99, 40 + 4 * 0.014472]);
  assert.ok(Math.abs(at.alongMeters / MILE_METERS - 4) < 0.05);
  assert.ok(Math.abs(at.offMeters - 853) < 15, `off ${at.offMeters}`);
  const samples = route.sample(MILE_METERS);
  assert.equal(samples.length, 11);
});

test("chainLines orders scattered pieces end to end so miles count along the trail", () => {
  const chained = chainLines([north(4, 6), north(0, 2), [...north(2, 4)].reverse()]);
  const route = new Route(chained);
  const at3 = route.locate([-105, 40 + 3 * 0.014472]);
  const at5 = route.locate([-105, 40 + 5 * 0.014472]);
  assert.ok(Math.abs(Math.abs(at5.alongMeters - at3.alongMeters) / MILE_METERS - 2) < 0.1, "miles 3 and 5 are 2 miles apart");
});

test("crossings are found where segments intersect", () => {
  assert.deepEqual(segmentIntersection([0, 0], [2, 2], [0, 2], [2, 0]), [1, 1]);
  assert.equal(segmentIntersection([0, 0], [1, 0], [0, 1], [1, 1]), null);
});

test("climb ignores DEM noise below the threshold", () => {
  assert.deepEqual(climb([100, 101, 100, 102, 101]), { gain: 0, loss: 0 });
  const { gain, loss } = climb([100, 150, 120, 200]);
  assert.equal(gain, 130);
  assert.equal(loss, 30);
});

const services = (counts: TownServices["counts"]): TownServices => ({ counts, places: {}, radiusKm: 3 });
const town = (id: number, mile: number, off = 2, counts: TownServices["counts"] = { grocery: 1, post: 1, laundry: 1 }) =>
  ({ id, name: `Town ${id}`, state: "Colorado", country: "US", latitude: 40, longitude: -105, population: 1000, trailMile: mile, milesOffTrail: off, services: services(counts) });

test("town days: stops keep every carry within the limit and say what to buy", () => {
  // 10 mi/day with at most 5 days of food: each stretch is at most 50 miles.
  const plan = planTownDays([town(1, 30), town(2, 45), town(3, 90), town(4, 140), town(5, 160)], { trailMiles: 200, days: 20, maxCarryDays: 5, foodLbPerDay: 2, startDate: "2027-07-01" });
  assert.equal(plan.milesPerDay, 10);
  assert.deepEqual(plan.stops.map((s) => s.town.id), [2, 3, 4, 5], "the farthest town in reach each time");
  for (let i = 1; i < plan.stops.length; i++) assert.ok(plan.stops[i].trailMile - plan.stops[i - 1].trailMile <= 50);
  assert.ok(200 - plan.stops[plan.stops.length - 1].trailMile <= 50, "the last stretch is carryable");
  assert.equal(plan.stops[0].arriveDay, 5);
  assert.equal(plan.stops[0].date, "2027-07-05");
  assert.equal(plan.stops[0].foodDays, 5);
  assert.equal(plan.stops[0].foodLb, 10);
  assert.equal(plan.startFoodDays, 5);
  assert.ok(plan.stops[0].checklist.some((c) => /Do laundry/.test(c)));
  assert.equal(plan.gaps.length, 0);
});

test("town days: a stretch with no reachable town is reported, not filled in", () => {
  const plan = planTownDays([town(1, 150)], { trailMiles: 200, days: 20, maxCarryDays: 5 });
  assert.ok(plan.gaps.length >= 1);
  assert.equal(plan.gaps[0].fromMile, 0);
  assert.match(plan.notes.join(" "), /mail a resupply box/);
});

test("town days: a short trip needs no stop", () => {
  const plan = planTownDays([town(1, 5)], { trailMiles: 20, days: 2 });
  assert.equal(plan.stops.length, 0);
  assert.match(plan.notes.join(" "), /no town stop is needed/);
});

test("town checklist warns when a town has no grocery or post office", () => {
  const { warnings } = townChecklist(services({ food: 2 }), 3, 5.3);
  assert.equal(warnings.length, 2);
  const { checklist } = townChecklist(services({ grocery: 1 }), 3, 5.3, ["fuel canister"]);
  assert.ok(checklist.includes("Restock fuel canister"));
});

test("towns near a trail are found and placed at their trail mile", () => {
  const towns: Town[] = [
    { id: 1, name: "Near", state: "CO", country: "US", latitude: 40 + 3 * 0.014472, longitude: -104.98, population: 900 },
    { id: 2, name: "Far", state: "CO", country: "US", latitude: 41.5, longitude: -103, population: 90_000 },
  ];
  const near = townsNear(towns, [north(0, 10)], 15);
  assert.deepEqual(near.map((t) => t.name), ["Near"]);
  assert.ok(Math.abs(near[0].trailMile - 3) < 0.1);
});

test("downloads: GPX has track and water/town waypoints; CSV and packet escape text", () => {
  const trail = { id: "usgs-x", name: "Ridge & <Loop>", miles: 3, region: "Colorado", country: "US", manager: null, sourceUrl: "https://example.com", trailhead: undefined } as unknown as CatalogTrail;
  const bundle: TripBundle = {
    trail,
    lines: [north(0, 3) as [number, number][]],
    water: { sources: [{ kind: "spring", name: 'Cold "Spring"', mile: 1.2, offTrailMeters: 40, crossing: false, reliability: "treat", latitude: 40.01, longitude: -105 }], longestDryMiles: 1.8, trailMiles: 3, partial: false, unreadableTiles: 0, attribution: "", notes: [] },
    towns: [{ ...town(1, 2), services: services({ grocery: 2 }) }],
    elevation: null,
    plan: null,
    pack: [{ name: "Tent", quantity: 1, weightOz: 32 }],
    siteUrl: "https://hyked.app",
    generatedAt: "2027-01-01T00:00:00.000Z",
  };
  const gpx = tripGpx(bundle);
  assert.match(gpx, /<trk><name>Ridge &amp; &lt;Loop&gt;<\/name>/);
  assert.match(gpx, /<type>water<\/type>/);
  assert.match(gpx, /<type>town<\/type>/);
  assert.match(waterCsv(bundle), /"Cold ""Spring"""/);
  const html = tripPacketHtml(bundle);
  assert.match(html, /Ridge &amp; &lt;Loop&gt;/);
  assert.match(html, /Tent/);
  assert.match(html, /longest stretch without dependable water: <strong>1.8 mi/);
});
