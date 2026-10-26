import { test } from "node:test";
import assert from "node:assert/strict";
import { describeTrail, trailHighlights } from "./describe";
import type { CatalogTrail } from "./types";

const yosemite = { id: "x", name: "Yosemite Falls Trail", country: "US", region: "California", park: "Yosemite National Park", miles: 3, gainFt: 3027, maxElevFt: 6936, routeType: "out-and-back", uses: ["hiking"], dogs: false } as unknown as CatalogTrail;

test("describes a trail from its measured facts", () => {
  const text = describeTrail(yosemite, { difficulty: "hard", time: "3–4 h", units: "imperial" });
  assert.match(text, /^Yosemite Falls Trail is a 3\.0 mi out-and-back trail in Yosemite National Park, California\./);
  assert.match(text, /a hard route, it climbs about 3,027 ft and takes about 3–4 h to complete\./);
  assert.match(text, /tops out at 6,936 ft/);
  assert.match(text, /Popular for hiking\./);
  assert.match(text, /Dogs aren’t allowed\./);
});

test("highlights come from the name, mapped features and facts", () => {
  assert.deepEqual(trailHighlights(yosemite, ["viewpoint", "parking", "waterfall"]), ["Waterfall", "Views"]);
  assert.deepEqual(trailHighlights({ name: "Lake Loop", routeType: "loop", dogs: true, maxElevFt: 10500 }), ["Lake", "Loop", "Dog friendly", "High elevation"]);
});
