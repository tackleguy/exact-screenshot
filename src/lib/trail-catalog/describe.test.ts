import { test } from "node:test";
import assert from "node:assert/strict";
import { describeTrail, describeTrailParts, profileShape, trailHighlights, typicalSeason } from "./describe";
import type { CatalogTrail } from "./types";

const yosemite = { id: "x", name: "Yosemite Falls Trail", country: "US", region: "California", park: "Yosemite National Park", miles: 3, gainFt: 3027, minElevFt: 3990, maxElevFt: 6936, latitude: 37.75, longitude: -119.6, routeType: "out-and-back", uses: ["hiking"], dogs: false, manager: "National Park Service", source: "nps" } as unknown as CatalogTrail;
const sentences = (text: string) => text.split(/(?<=\.)\s+(?=[A-Z])/).length;

test("describes a trail from its real data in 2–3 sentences", () => {
  const text = describeTrail(yosemite, { difficulty: "hard", time: "3–4 h", units: "imperial" });
  assert.match(text, /Yosemite Falls Trail/);
  assert.match(text, /3\.0 mi out-and-back hike/);
  assert.match(text, /Yosemite National Park, California/);
  assert.match(text, /hard/);
  assert.match(text, /steady climb|sustained|steadily/);
  assert.match(text, /6,940 ft/);
  assert.match(text, /National Park Service/);
  const n = sentences(text);
  assert.ok(n >= 2 && n <= 3, text);
});

test("links the land manager's official page", () => {
  const parts = describeTrailParts(yosemite, { difficulty: "hard", units: "imperial" });
  assert.ok(parts.some((p) => typeof p === "object" && p.href === "https://www.nps.gov/"));
  const own = describeTrailParts({ ...yosemite, officialUrl: "https://www.nps.gov/yose/" }, { difficulty: "hard", units: "imperial" });
  assert.ok(own.some((p) => typeof p === "object" && p.href === "https://www.nps.gov/yose/" && p.text === "Yosemite National Park"));
});

test("mentions features from the trail and varies wording between trails", () => {
  const text = describeTrail(yosemite, { difficulty: "hard", units: "imperial", features: [{ type: "waterfall", name: "Upper Yosemite Fall" }, { type: "viewpoint" }, { type: "viewpoint" }, { type: "campsite" }] });
  assert.match(text, /passing Upper Yosemite Fall, two viewpoints and a mapped campsite/);
  const leads = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => describeTrail({ ...yosemite, id }, { difficulty: "hard", time: "3 h", units: "imperial" }).split(".")[0].slice(0, 12)));
  assert.ok(leads.size >= 3, [...leads].join(" / "));
});

test("reads the shape of the elevation profile", () => {
  const climb: [number, number][] = Array.from({ length: 20 }, (_, i) => [i * 0.2, 1000 + i * 100]);
  const rolling: [number, number][] = Array.from({ length: 40 }, (_, i) => [i * 0.2, 1000 + (i % 4 < 2 ? 0 : 300)]);
  const ridge: [number, number][] = [[0, 1000], [0.5, 2000], [1, 2900], [1.5, 3000], [2, 2950], [2.5, 3000], [3, 2980], [3.5, 3000], [4, 2900], [4.5, 2950]];
  const flat: [number, number][] = Array.from({ length: 10 }, (_, i) => [i, 500 + (i % 2) * 20]);
  assert.equal(profileShape(climb), "steady-climb");
  assert.equal(profileShape(rolling), "rolling");
  assert.equal(profileShape(ridge), "ridge");
  assert.equal(profileShape(flat), "flat");
  assert.equal(profileShape(null, { gainFt: 80, minElevFt: 100, maxElevFt: 140 }), "flat");
});

test("typical season comes from the record or the high point and latitude", () => {
  assert.equal(typicalSeason({ season: "Jul-Sep", maxElevFt: 9000, latitude: 40, region: "Colorado", country: "US" }), "usually open from July to September");
  assert.match(typicalSeason({ season: null, maxElevFt: 12000, latitude: 39.5, region: "Colorado", country: "US" })!, /snow-free/);
  assert.match(typicalSeason({ season: null, maxElevFt: 2000, latitude: 33.5, region: "Arizona", country: "US" })!, /summer heat/);
});

test("highlights come from the name, mapped features and facts", () => {
  assert.deepEqual(trailHighlights(yosemite, ["viewpoint", "parking", "waterfall"]), ["Waterfall", "Views"]);
  assert.deepEqual(trailHighlights({ name: "Lake Loop", routeType: "loop", dogs: true, maxElevFt: 10500 }), ["Lake", "Loop", "Dog friendly", "High elevation"]);
});
