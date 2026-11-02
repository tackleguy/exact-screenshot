import { test } from "node:test";
import assert from "node:assert/strict";
import { displayTrailName, tidyTrailName, withDisplayName } from "./naming";
import { isListStub } from "./search";
import type { CatalogTrail } from "./types";

const base = { id: "osm-1", country: "US", region: "California", kind: "segment", source: "osm" } as unknown as CatalogTrail;
const name = (over: Partial<CatalogTrail>) => displayTrailName({ ...base, ...over });

test("single-word and incomplete names get a trail word and their place", () => {
  assert.equal(name({ name: "Burton", forest: "Angeles National Forest" }), "Burton Trail — Angeles National Forest");
  assert.equal(name({ name: "Eagle Rock", park: "Topanga State Park" }), "Eagle Rock Trail — Topanga State Park");
  assert.equal(name({ name: "Skyline", park: "Mount Rainier National Park", region: "Washington" }), "Skyline Trail — Mount Rainier National Park");
  // Place names (the name is the park itself) say where instead of repeating it.
  assert.equal(name({ name: "Griffith Park", park: "Griffith Park" }), "Griffith Park Trail — California");
});

test("complete names, curated guides and placeholders are kept", () => {
  assert.equal(name({ name: "Bright Angel Trail", park: "Grand Canyon National Park" }), "Bright Angel Trail");
  assert.equal(name({ name: "Crawford Path" }), "Crawford Path");
  assert.equal(name({ name: "Barker Fire Road" }), "Barker Fire Road");
  assert.equal(name({ name: "Pacific Crest", kind: "route" }), "Pacific Crest");
  assert.equal(name({ name: "Unnamed trail · abc123" }), "Unnamed trail · abc123");
  assert.equal(name({ name: "Path" }), "Path");
  // Outside English-speaking countries no English word is added.
  assert.equal(name({ name: "Hude", country: "DE", region: "Niedersachsen" }), "Hude — Niedersachsen");
  assert.equal(name({ name: "Höhenweg Panorama", country: "AT", region: "Tirol" }), "Höhenweg Panorama");
});

test("source clutter is removed and Wikipedia titles complete names", () => {
  assert.equal(tidyTrailName("16006: West Kern River Usgs Lake Isabella North"), "West Kern River");
  assert.equal(tidyTrailName("Baldwin Hills Unk1"), "Baldwin Hills");
  assert.equal(tidyTrailName("Silver Moccasin Nrt"), "Silver Moccasin National Recreation Trail");
  assert.equal(tidyTrailName("7 - Genesee Valley Greenway"), "Genesee Valley Greenway");
  assert.equal(name({ name: "Wonderland", wiki: { qid: "Q1", title: "Wonderland Trail" } }), "Wonderland Trail");
});

test("the source name is kept when the display name changes", () => {
  const t = withDisplayName({ ...base, name: "Burton", forest: "Angeles National Forest" });
  assert.equal(t.originalName, "Burton");
  const same = { ...base, name: "Bright Angel Trail" };
  assert.equal(withDisplayName(same), same);
});

test("lists treat unmapped, unmeasured and very short pieces as stubs", () => {
  const trail = { ...base, name: "A Trail", miles: 2, geometryShard: "1_2", bounds: [0, 0, 1, 1] } as CatalogTrail;
  assert.equal(isListStub(trail), false);
  assert.equal(isListStub({ ...trail, miles: 0.2 }), true);
  assert.equal(isListStub({ ...trail, miles: null }), true);
  assert.equal(isListStub({ ...trail, bounds: undefined, geometryShard: "" }), true);
  assert.equal(isListStub({ ...trail, kind: "route", miles: null }), false);
  assert.equal(isListStub({ ...trail, source: "peak", miles: 0.1 }), false);
});
