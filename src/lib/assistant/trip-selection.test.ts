import test from "node:test";
import assert from "node:assert/strict";
import { parseTripRequest, EMPTY_REQUEST } from "./planning";
import { parsePlaces } from "./places";
import { shoppingForTrip, cleanShopping, shoppingText } from "./shopping";
import { parseMemory } from "./memory";
import { distanceKm, filterCatalog } from "../trail-catalog/search";
import type { CatalogTrail } from "../trail-catalog/types";
import type { PlannerGear } from "./types";
const gear = (name: string): PlannerGear => ({ id: name, name, category: "Misc", type: "Base", qty: 1, weightOz: null, packedSize: null, sourceUrl: null });

test("nearby parsing retains landmark names, accented places and leading locations", () => {
  for (const input of ["30 miles 3 days near Banff, AB", "near Banff, AB 30 miles 3 days"]) {
    const trip = parseTripRequest(input); assert.equal(trip.region, "Banff, AB"); assert.equal(trip.locationMode, "near"); assert.equal(trip.days, 3); assert.equal(trip.distanceMiles, 30);
  }
  assert.equal(parseTripRequest("3 days around Mont-Tremblant, Québec").region, "Mont-Tremblant, Québec");
  assert.equal(parseTripRequest("30 miles in Colorado").locationMode, "in");
});
test("geocoding retains ambiguous US/Canada choices and rejects malformed coordinates and other countries", () => {
  const feature = (countrycode: string, coordinates: unknown, name = "Banff") => ({ properties: { name, countrycode, osm_id: name, osm_type: "N", state: "Alberta", country: "Canada" }, geometry: { coordinates } });
  const places = parsePlaces({ features: [feature("CA", [-115.57, 51.17]), feature("US", [-100, 45], "Banff park"), feature("GB", [0, 50]), feature("CA", [Infinity, 50]), feature("CA", ["-115", 50]), null] });
  assert.equal(places.length, 2); assert.equal(places[0].latitude, 51.17); assert.equal(places[0].longitude, -115.57);
});
test("nearby catalog stays within radius even when distant sections better match trip length", () => {
  const base = { name: "Lake Trail", country: "CA", region: "Alberta", longitude: -115.57, miles: 3 } as CatalogTrail;
  const rows = [{ ...base, id: "near", latitude: 51.18 }, { ...base, id: "farther", latitude: 51.24 }, { ...base, id: "outside", latitude: 52, miles: 30 }];
  const filters = { lat: 51.17, lng: -115.57, radiusKm: 10 };
  assert.deepEqual(filterCatalog(rows, filters).trails.map(r => r.id), ["near", "farther"]);
  assert.ok(filterCatalog(rows, { ...filters, targetMiles: 30 }).trails.every(r => distanceKm(filters.lat, filters.lng, r.latitude, r.longitude) <= 10));
  assert.equal(filterCatalog(rows, { ...filters, radiusKm: .1 }).total, 0);
});
test("shopping compares the entire locker, separates sleep pad from bag and adapts to days and cold", () => {
  const trip = { ...EMPTY_REQUEST, days: 3, lowTempF: 25 };
  const items = shoppingForTrip(trip, [gear("Tent"), gear("Sleeping bag"), gear("Headlamp")], []);
  assert.ok(!items.some(i => ["shelter", "sleep", "light"].includes(i.id)));
  assert.ok(items.some(i => i.id === "pad")); assert.ok(items.some(i => i.id === "warmth"));
  assert.ok(!shoppingForTrip({ ...trip, days: 1, lowTempF: 50 }, [], []).some(i => ["sleep", "shelter", "pad", "warmth"].includes(i.id)));
  assert.ok(shoppingForTrip(trip, [{ ...gear("Tent"), qty: 0 }], []).some(i => i.id === "shelter"));
});
test("shopping edits survive recalculation, adding owned gear removes the need, exports preserve status", () => {
  const edits = cleanShopping([{ id: "shelter", name: "Shelter", status: "obtained" }, { id: "custom:1", name: "Camera battery", status: "skip" }, { id: "bad", name: "", status: "needed" }]);
  const trip = { ...EMPTY_REQUEST, days: 3 };
  const items = shoppingForTrip(trip, [], edits);
  assert.equal(items.find(i => i.id === "shelter")?.status, "obtained"); assert.equal(items.find(i => i.id === "custom:1")?.status, "skip");
  assert.ok(!shoppingForTrip(trip, [gear("Tent"), gear("Camera battery")], edits).some(i => ["shelter", "custom:1"].includes(i.id)));
  assert.match(shoppingText(items), /\[x\] Overnight shelter/); assert.match(shoppingText(items), /Not needed for this trip/);
});
test("saved plans restore confirmed geography, section provenance and shopping statuses while handling old data", () => {
  const request = { ...EMPTY_REQUEST, locationMode: "near", radiusKm: 25, region: "Banff", place: { id: "1", name: "Banff, Alberta", latitude: 51.17, longitude: -115.57 } };
  const m = parseMemory(JSON.stringify({ version: 1, plans: [{ id: "1", savedAt: "2026-09-22", request, shopping: [{ id: "light", name: "Headlamp", status: "obtained" }], route: { id: "catalog:1", name: "Trail", distanceMiles: 4, kind: "segment", catalogHref: "/explore/trails/catalog-1" } }, { id: "old", savedAt: "old", request: {} }] }));
  assert.deepEqual(m.plans[0].request.place, request.place); assert.equal(m.plans[0].shopping?.[0].status, "obtained"); assert.equal(m.plans[0].route?.kind, "segment"); assert.equal(m.plans[0].route?.catalogHref, "/explore/trails/catalog-1");
  assert.equal(m.plans[1].request.locationMode, "in"); assert.deepEqual(m.plans[1].shopping, []);
});


test("shopping recognizes categorized shelter models without treating accessories as shelter or food", () => {
  const trip = { ...EMPTY_REQUEST, days: 3 };
  assert.ok(!shoppingForTrip(trip, [{ ...gear("MSR Hubba Hubba"), category: "Shelter" }], []).some(i => i.id === "shelter"));
  const items = shoppingForTrip(trip, [{ ...gear("Tent stakes"), category: "Shelter" }, gear("Food bag")], []);
  assert.ok(items.some(i => i.id === "shelter")); assert.ok(items.some(i => i.id === "food"));
  assert.ok(!items.some(i => i.id === "storage"));
});
