import test from "node:test";
import assert from "node:assert/strict";
import {
  matchesCatalogActivity,
  parseCatalogActivity,
  sectionOf,
  trailActivities,
} from "./activity";
import { filterCatalog, parseCatalogFilters } from "./search";
import type { CatalogTrail } from "./types";

function stub(partial: Partial<CatalogTrail> & Pick<CatalogTrail, "id" | "name">): CatalogTrail {
  return {
    country: "US",
    region: "Colorado",
    kind: "segment",
    miles: 5,
    distanceBasis: "source",
    latitude: 40,
    longitude: -105,
    difficulty: null,
    dogs: null,
    source: "usgs",
    sourceId: partial.id,
    sourceUrl: "https://example.com",
    officialUrl: null,
    sourceDate: null,
    manager: null,
    surface: null,
    season: null,
    geometryShard: "00",
    tags: [],
    ...partial,
  };
}

test("activity parsing defaults and rejects unknown values", () => {
  assert.equal(parseCatalogActivity("hike"), "hike");
  assert.equal(parseCatalogActivity("trail running"), undefined);
  assert.equal(parseCatalogFilters(new URLSearchParams()).activity, "hike");
  assert.equal(parseCatalogFilters(new URLSearchParams("activity=bike")).activity, "bike");
  assert.equal(parseCatalogFilters(new URLSearchParams("activity=ski")).includeWinter, true);
});

test("classifies backpacking, bike, run and ski from name and length", () => {
  assert.ok(trailActivities(stub({ id: "h", name: "Pine Creek Trail" })).includes("hike"));
  assert.ok(matchesCatalogActivity(stub({ id: "b", name: "Pine Creek MTB Trail" }), "bike"));
  assert.ok(matchesCatalogActivity(stub({ id: "r", name: "Riverfront Trail Run" }), "run"));
  assert.ok(matchesCatalogActivity(stub({ id: "s", name: "Nordic Ski Loop" }), "ski"));
  assert.ok(
    matchesCatalogActivity(stub({ id: "p", name: "High Sierra", kind: "route", miles: 80 }), "backpack"),
  );
  assert.ok(matchesCatalogActivity(stub({ id: "l", name: "Long Canyon", miles: 22 }), "backpack"));
  assert.equal(matchesCatalogActivity(stub({ id: "w", name: "Nordic Ski Loop" }), "hike"), false);
});

test("default hike filter keeps summer hiking and drops ski-named sections", () => {
  const rows = [
    stub({ id: "hike", name: "Eagle Peak Trail" }),
    stub({ id: "ski", name: "Eagle Peak Ski Trail" }),
    stub({ id: "bike", name: "Eagle Peak Bike Path" }),
    stub({ id: "route", name: "Continental Divide Trail", kind: "route", miles: 100 }),
  ];
  assert.deepEqual(filterCatalog(rows, { activity: "hike" }).trails.map((t) => t.id).sort(), [
    "hike",
    "route",
  ]);
  assert.deepEqual(filterCatalog(rows, { activity: "ski" }).trails.map((t) => t.id), ["ski"]);
  assert.deepEqual(filterCatalog(rows, { activity: "bike" }).trails.map((t) => t.id), ["bike"]);
  assert.ok(filterCatalog(rows, { activity: "backpack" }).trails.some((t) => t.id === "route"));
  assert.ok(filterCatalog(rows, { activity: "run" }).trails.some((t) => t.id === "hike"));
});

test("OpenStreetMap pistes and water trails get the snow, sled and paddle sections", () => {
  const sled = stub({ id: "sled", name: "Rodelbahn Hahnenkamm", source: "osm", winterUse: "downhill", osmWay: { ids: [1], highway: "piste", pisteType: "sled" }, uses: ["Sledding"] });
  assert.deepEqual(trailActivities(sled).sort(), ["ski", "sled"]);
  const sledRoute = stub({ id: "sr", name: "Schlittenweg", source: "osm", osm: { relation: 2, route: "piste", pisteType: "sled" } });
  assert.deepEqual(trailActivities(sledRoute), ["ski", "sled"]);
  const canoe = stub({ id: "c", name: "Bowron Lakes Canoe Circuit", source: "osm", osm: { relation: 3, route: "canoe" } });
  assert.deepEqual(trailActivities(canoe), ["paddle"]);
  assert.equal(sectionOf("paddle").key, "water");
  assert.equal(sectionOf("sled").key, "snow");
  assert.equal(parseCatalogFilters(new URLSearchParams("activity=sled")).includeWinter, true);
  assert.deepEqual(filterCatalog([sled, stub({ id: "h", name: "Hahnenkamm Trail" })], { activity: "sled" }).trails.map((t) => t.id), ["sled"]);
  assert.deepEqual(filterCatalog([sled, stub({ id: "h", name: "Hahnenkamm Trail" })], { activity: "hike" }).trails.map((t) => t.id), ["h"]);
});
