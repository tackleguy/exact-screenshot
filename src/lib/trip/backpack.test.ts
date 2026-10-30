import test from "node:test";
import assert from "node:assert/strict";
import { backpackStops, nextStops } from "./backpack";
import { campsiteLink, permitLinks } from "./permits";
import type { TrailFeature } from "@/lib/trail-catalog/features";
import type { TownNearTrail } from "./towns-core";

const f = (type: TrailFeature["type"], mile: number, name = type, extra: TrailFeature["extra"] = {}): TrailFeature => ({ id: `${type}-${mile}`, type, name, lat: 0, lon: 0, source: "x", extra, mile, offTrailFt: 50 });
const town = (name: string, trailMile: number) => ({ name, trailMile, milesOffTrail: 3 } as unknown as TownNearTrail);

test("campsites, shelters, water and towns are listed in mile order; viewpoints and parking are not", () => {
  const stops = backpackStops([f("viewpoint", 1), f("spring", 2.5), f("campsite", 6), f("shelter", 9), f("parking", 0), f("crossing", 4)], [town("Lone Pine", 12)]);
  assert.deepEqual(stops.map((s) => [s.kind, s.mile]), [["water", 2.5], ["water", 4], ["camp", 6], ["camp", 9], ["town", 12]]);
});

test("what comes next from the hiker's mile", () => {
  const stops = backpackStops([f("spring", 2.5), f("campsite", 6), f("campsite", 9), f("lake", 7)], [town("Lone Pine", 12)]);
  const next = nextStops(stops, 6.5);
  assert.equal(next.water?.stop.mile, 7);
  assert.ok(Math.abs(next.water!.milesAhead - 0.5) < 1e-9);
  assert.equal(next.camp?.stop.mile, 9);
  assert.equal(next.town?.milesAhead, 5.5);
  assert.deepEqual(nextStops(stops, null), {});
  assert.equal(nextStops(stops, 20).camp, undefined, "nothing ahead after the last one");
});

test("permit links: named trails get their official permit pages, every US trail a Recreation.gov search", () => {
  const jmt = permitLinks({ id: "route-jmt", name: "John Muir Trail", park: undefined, forest: undefined, manager: null, country: "US", officialUrl: null });
  assert.ok(jmt.some((l) => l.url === "https://www.recreation.gov/permits/445859"));
  assert.ok(jmt.some((l) => l.url === "https://www.recreation.gov/permits/233260"));
  const falls = permitLinks({ id: "x", name: "Yosemite Falls Trail", park: "Yosemite National Park", forest: undefined, manager: null, country: "US", officialUrl: "https://www.nps.gov/yose/" });
  assert.deepEqual(falls.map((l) => l.kind), ["park", "park", "search", "search"]);
  assert.match(falls[2].url, /recreation\.gov\/search\?q=Yosemite%20National%20Park/);
  assert.equal(new Set(falls.map((l) => l.url)).size, falls.length, "no duplicates");
  const uk = permitLinks({ id: "y", name: "West Highland Way", park: undefined, forest: undefined, manager: null, country: "GB", officialUrl: null });
  assert.deepEqual(uk, []);
  assert.ok(permitLinks({ id: "z", name: "Milford Track", park: undefined, forest: undefined, manager: null, country: "NZ", officialUrl: null }).some((l) => l.kind === "camping"));
});

test("campsite booking links come from the mapped website tags only", () => {
  assert.equal(campsiteLink({ website: "https://camping.ehawaii.gov/camping/", fee: "yes" }), "https://camping.ehawaii.gov/camping/");
  assert.equal(campsiteLink({ "reservation:website": "https://example.org/book", website: "https://example.org" }), "https://example.org/book");
  assert.equal(campsiteLink({ website: "camping.example" }), null);
  assert.equal(campsiteLink({}), null);
});
