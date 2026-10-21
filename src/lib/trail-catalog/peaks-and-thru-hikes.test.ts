import test from "node:test";
import assert from "node:assert/strict";
import { getAllPeakTrails, getPeakGeometry, PEAK_DEFINITIONS } from "./peaks";
import {
  DETAILED_THRU_HIKES,
  getDetailedThruHikeTrails,
  getDetailedThruHikeLines,
  getSectionLine,
} from "./through-hikes-data";
import { filterCatalog, parseCatalogFilters } from "./search";
import { fetchOpenMeteoForecast } from "@/lib/weather/open-meteo";

test("peaks: includes all 14ers, all 14 8,000m peaks, and the Seven Summits", () => {
  const peaks = getAllPeakTrails();
  assert.ok(peaks.length >= 25);

  // Check 14ers
  const fourteeners = peaks.filter((p) => p.peakCategory === "14er");
  assert.ok(fourteeners.length >= 15);
  const elbert = fourteeners.find((p) => p.id === "summit-elbert");
  assert.ok(elbert);
  assert.equal(elbert!.summitElevationFt, 14440);
  const whitney = fourteeners.find((p) => p.id === "summit-whitney");
  assert.ok(whitney);
  assert.equal(whitney!.summitElevationFt, 14505);
  const rainier = fourteeners.find((p) => p.id === "summit-rainier");
  assert.ok(rainier);
  assert.equal(rainier!.summitElevationFt, 14411);

  // Check 8,000m peaks (all 14)
  const eightThousanders = peaks.filter((p) => p.peakCategory === "8000m" || p.tags?.includes("8000m"));
  assert.ok(eightThousanders.length >= 14);
  const names = eightThousanders.map((p) => p.name.toLowerCase());
  const required = [
    "everest",
    "k2",
    "kangchenjunga",
    "lhotse",
    "makalu",
    "cho oyu",
    "dhaulagiri",
    "manaslu",
    "nanga parbat",
    "annapurna",
    "gasherbrum",
    "broad peak",
    "shishapangma",
  ];
  for (const req of required) {
    assert.ok(
      names.some((n) => n.includes(req)),
      `Missing 8000m peak matching: ${req}`,
    );
  }

  // Check Seven Summits
  const sevenSummits = peaks.filter((p) => p.peakCategory === "seven-summits");
  assert.ok(sevenSummits.length >= 7);
  const ssNames = sevenSummits.map((p) => p.name.toLowerCase());
  for (const s of ["everest", "aconcagua", "denali", "kilimanjaro", "elbrus", "vinson", "puncak jaya"]) {
    assert.ok(
      ssNames.some((n) => n.includes(s)),
      `Missing Seven Summit: ${s}`,
    );
  }
});

test("peaks: each peak has valid geometry, coordinates, and elevations", () => {
  for (const def of PEAK_DEFINITIONS) {
    const lines = getPeakGeometry(def.id);
    assert.ok(lines && lines.length > 0, `Peak ${def.id} has no geometry lines`);
    assert.ok(lines[0].length >= 10, `Peak ${def.id} geometry line too short`);
    assert.ok(Number.isFinite(def.latitude) && Number.isFinite(def.longitude));
    assert.ok(def.summitElevationFt > 0);
    assert.ok(def.summitElevationM > 0);
  }
});

test("thru-hikes: provides full routes all together AND individual sections", () => {
  const { thruHikes, sections } = getDetailedThruHikeTrails();

  // Full routes all together
  assert.ok(thruHikes.length >= 5);
  const ct = thruHikes.find((h) => h.id === "route-ct");
  assert.ok(ct);
  assert.equal(ct!.kind, "route");
  assert.equal(ct!.miles, 486);
  assert.ok(ct!.sections && ct!.sections.length > 0, "CT should have sections attached");

  const jmt = thruHikes.find((h) => h.id === "route-jmt");
  assert.ok(jmt);
  assert.equal(jmt!.miles, 211);
  assert.ok(jmt!.sections && jmt!.sections.length >= 6);

  // Individual sections
  assert.ok(sections.length >= 20);
  const ct1 = sections.find((s) => s.id === "ct-seg-1");
  assert.ok(ct1);
  assert.equal(ct1!.kind, "segment");
  assert.equal(ct1!.partOfRoute?.id, "route-ct");
  assert.equal(ct1!.partOfRoute?.name, "The Colorado Trail");

  const jmt1 = sections.find((s) => s.id === "jmt-sec-1");
  assert.ok(jmt1);
  assert.equal(jmt1!.partOfRoute?.id, "route-jmt");

  // Geometries
  const ctLines = getDetailedThruHikeLines("route-ct");
  assert.ok(ctLines && ctLines.length > 0);
  const secLine = getSectionLine("ct-seg-1");
  assert.ok(secLine && secLine.length > 0);
});

test("catalog filters: collections for 14ers, 8000m, 7summits, thru-hikes, and thru-sections", () => {
  const { thruHikes, sections } = getDetailedThruHikeTrails();
  const peaks = getAllPeakTrails();
  const pool = [...thruHikes, ...sections, ...peaks];

  // 14ers collection
  const f14 = parseCatalogFilters(new URLSearchParams("collection=14ers"));
  const r14 = filterCatalog(pool, f14);
  assert.ok(r14.total >= 10);
  assert.ok(r14.trails.every((t) => t.peakCategory === "14er" || t.tags?.includes("14er")));

  // 8000m collection
  const f8k = parseCatalogFilters(new URLSearchParams("collection=8000m"));
  const r8k = filterCatalog(pool, f8k);
  assert.ok(r8k.total >= 14);
  assert.ok(r8k.trails.every((t) => t.peakCategory === "8000m" || t.tags?.includes("8000m")));

  // 7summits collection
  const f7s = parseCatalogFilters(new URLSearchParams("collection=7summits"));
  const r7s = filterCatalog(pool, f7s);
  assert.ok(r7s.total >= 7);
  assert.ok(r7s.trails.every((t) => t.peakCategory === "seven-summits" || t.tags?.includes("Seven Summits")));

  // Thru-hikes collection (all together)
  const fThru = parseCatalogFilters(new URLSearchParams("collection=thru-hikes"));
  const rThru = filterCatalog(pool, fThru);
  assert.ok(rThru.total >= 4);
  assert.ok(rThru.trails.every((t) => t.kind === "route" && !t.peakCategory));

  // Thru-sections collection (in sections)
  const fSec = parseCatalogFilters(new URLSearchParams("collection=thru-sections"));
  const rSec = filterCatalog(pool, fSec);
  assert.ok(rSec.total >= 20);
  assert.ok(rSec.trails.every((t) => Boolean(t.partOfRoute)));
});

test("weather forecast: fetches real worldwide Open-Meteo forecasts", async () => {
  // Test Mount Everest coordinates
  const forecast = await fetchOpenMeteoForecast(27.9881, 86.925);
  assert.ok(forecast.periods.length > 0);
  assert.ok(forecast.periods[0].shortForecast);
  assert.equal(typeof forecast.attribution.label, "string");
});
