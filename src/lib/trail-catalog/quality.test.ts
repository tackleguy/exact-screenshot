import test from "node:test";
import assert from "node:assert/strict";
import { assessTrail, findFragmentParents, formatDistance, isPlaceholderName, measureLines, MILE_METERS, type Lines } from "./quality";
import { auditCatalog } from "./audit";
import { mergeCatalogSections, mergeKey, type CatalogSection } from "./merge";
import { filterCatalog } from "./search";
import type { CatalogTrail } from "./types";

const base: CatalogTrail = {
  id: "usgs-a", name: "Overlook Trail", country: "US", region: "Colorado", kind: "segment", miles: null, distanceBasis: "geometry",
  latitude: 40, longitude: -105, difficulty: null, dogs: null, source: "usgs", sourceId: "a", sourceUrl: "https://example.com",
  officialUrl: null, sourceDate: null, manager: null, surface: null, season: null, geometryShard: "00",
};
// 0.001° of latitude is ~111 m.
const north = (fromMeters: number, toMeters: number, lng = -105): Lines => [[[lng, 40 + fromMeters / 111_195], [lng, 40 + toMeters / 111_195]]];
const path = (meters: number, lng = -105): Lines => {
  const points: [number, number][] = [];
  for (let m = 0; m <= meters; m += 20) points.push([lng + (m % 40 ? 0.00001 : 0), 40 + m / 111_195]);
  return [points];
};
const trail = (id: string, lines: Lines, patch: Partial<CatalogTrail> = {}) => {
  const miles = measureLines(lines).meters / MILE_METERS;
  return { row: { ...base, id, sourceId: id, miles, ...patch }, lines };
};

test("distance is measured along the whole path, not endpoint to endpoint", () => {
  const out = [[-105, 40], [-105, 40.01], [-105.00001, 40]] as [number, number][];
  const m = measureLines([out]);
  assert.ok(Math.abs(m.meters - 2 * 1112) < 5, `expected ~2224 m, got ${m.meters}`);
  assert.ok(m.start && m.end);
  assert.deepEqual(m.bounds, [-105.00001, 40, -105, 40.01]);
});

test("a legitimate 100-meter trail stays published as a short trail", () => {
  const { row, lines } = trail("usgs-short", path(100));
  const result = assessTrail(row, lines);
  assert.equal(result.status, "short");
  assert.deepEqual(result.flags, ["short"]);
  assert.ok(Math.abs(result.mappedMiles * MILE_METERS - 100) < 2);
  const [audited] = [row];
  auditCatalog([{ row: audited, lines }]);
  assert.equal(filterCatalog([audited], {}).total, 1, "short trails stay in default results");
});

test("a 100-meter piece of a longer same-name trail is flagged as a fragment and linked to it", () => {
  const long = trail("usgs-long", path(5000), { name: "Ridge Trail" });
  // Separated by a 600 m gap, so the merge did not join it.
  const piece = trail("usgs-piece", north(5600, 5700), { name: "Ridge Trail" });
  const report = auditCatalog([long, piece]);
  assert.equal(piece.row.quality, "fragment");
  assert.equal(piece.row.parentId, "usgs-long");
  assert.ok(piece.row.flags!.includes("fragment-of-longer-trail"));
  assert.equal(long.row.quality, "ok");
  assert.equal(report.byStatus.fragment, 1);
  assert.deepEqual(filterCatalog([long.row, piece.row], {}).trails.map((t) => t.id), ["usgs-long"]);
  assert.equal(filterCatalog([long.row, piece.row], { includeFragments: true }).total, 2);
});

test("same-name trails far apart are separate trails, not fragments", () => {
  const a = trail("usgs-a", path(5000), { name: "Ridge Trail" });
  const b = trail("usgs-b", path(200, -106), { name: "Ridge Trail" });
  auditCatalog([a, b]);
  assert.equal(b.row.parentId, undefined);
  assert.equal(b.row.quality, "short");
});

test("a valid long-distance trail passes", () => {
  const lines = path(40_000);
  const result = assessTrail({ ...base, miles: measureLines(lines).meters / MILE_METERS }, lines);
  assert.equal(result.status, "ok");
  assert.equal(result.routeType, "point-to-point");
});

test("a valid loop is detected as a loop", () => {
  const loop: Lines = [[[-105, 40], [-105, 40.005], [-104.995, 40.005], [-104.995, 40], [-105, 40]]];
  const result = assessTrail({ ...base, miles: null }, loop);
  assert.equal(result.routeType, "loop");
  assert.equal(result.status, "ok");
});

test("an out-and-back line whose ends meet is only a loop when it is long enough", () => {
  const tiny: Lines = [[[-105, 40], [-105, 40.0002], [-105, 40]]];
  assert.equal(assessTrail({ ...base, miles: null }, tiny).routeType, "point-to-point");
});

test("duplicate same-name sections merge once, with overlap counted once", () => {
  const section = (id: string, lines: Lines): CatalogSection => ({ row: { ...base, id, sourceId: id, name: "Ridge Trail" }, lines });
  const merged = mergeCatalogSections([section("usgs-a", north(0, 2000)), section("usgs-b", north(0, 2000))]);
  assert.equal(merged.length, 1);
  assert.ok(Math.abs(merged[0].row.miles! * MILE_METERS - 2000) < 40);
});

test("missing geometry is invalid and never given a distance", () => {
  const result = assessTrail({ ...base, miles: null }, []);
  assert.equal(result.status, "fragment");
  assert.ok(result.flags.includes("invalid-geometry"));
  assert.equal(result.mappedMiles, 0);
  assert.equal(formatDistance(null).primary, "Distance unknown");
});

test("invalid coordinates are rejected", () => {
  for (const lines of [[[[-105, 40], [-105, 95]]], [[[-105, 40], [Number.NaN, 40]]], [[[-105, 40]]]] as Lines[]) {
    assert.equal(measureLines(lines).valid, false);
    assert.ok(assessTrail({ ...base, miles: null }, lines).flags.includes("invalid-geometry"));
  }
});

test("disconnected segments are flagged for review, not joined", () => {
  const lines: Lines = [...path(2000), ...north(3000, 5000)];
  const result = assessTrail({ ...base, miles: measureLines(lines).meters / MILE_METERS }, lines);
  assert.ok(result.flags.includes("disconnected"));
  assert.equal(result.status, "review");
  assert.equal(result.routeType, "network");
  assert.equal(result.measure.pieces, 2);
  assert.equal(result.measure.components, 2);
  const tee: Lines = [[[-105, 40], [-105, 40.02]], [[-105.01, 40.01], [-105, 40.01]]];
  assert.equal(measureLines(tee).components, 1, "a T-junction is connected");
});

test("an incorrect stored distance is flagged and the source value kept for debugging", () => {
  const item = { ...trail("usgs-x", path(3000)), sectionReportedMiles: 9 };
  auditCatalog([item]);
  assert.ok(item.row.flags!.includes("distance-mismatch"));
  assert.equal(item.row.reportedMiles, 9);
  assert.equal(item.row.quality, "review");
});

test("a source that reports a much longer trail than is mapped marks the geometry incomplete", () => {
  const item = { ...trail("ontario-1", path(1000), { source: "ontario" }), reportedMiles: 12 };
  auditCatalog([item]);
  assert.ok(item.row.flags!.includes("incomplete-geometry"));
  assert.equal(item.row.quality, "review");
});

test("missing elevation is reported, never estimated", () => {
  const report = auditCatalog([trail("usgs-e", path(3000))]);
  assert.equal(report.missingElevation, 1);
});

test("placeholder names are not trail names and never merge", () => {
  for (const name of ["-", "<unnamed>", "(none)", "Unknown", "TEMP", "Trail", "  "]) assert.ok(isPlaceholderName(name), name);
  for (const name of ["Ridge Trail", "120", "Lanark Link"]) assert.equal(isPlaceholderName(name) && !/\d/.test(name), false, name);
  assert.equal(mergeKey({ ...base, name: "<unnamed>" }), null);
  const short = trail("usgs-u", path(150), { name: "Unnamed trail" });
  auditCatalog([short]);
  assert.equal(short.row.quality, "fragment");
});

test("short connectors and agency-wide network pieces are fragments; long ones stay", () => {
  const connector = trail("usgs-c", path(150), { name: "Connector Trail" });
  const longConnector = trail("usgs-lc", path(2000), { name: "Connector Trail", region: "Utah" });
  const pieces = Array.from({ length: 6 }, (_, i) => trail(`usgs-n${i}`, path(150, -100 - i), { name: "Loudoun County Trails", region: "Virginia" }));
  auditCatalog([connector, longConnector, ...pieces]);
  assert.equal(connector.row.quality, "fragment");
  assert.equal(longConnector.row.quality, "ok");
  assert.ok(pieces.every((p) => p.row.quality === "fragment" && p.row.flags!.includes("network-name")));
});

test("trails the source marks closed stay linkable but leave default results", () => {
  const closed = trail("usgs-closed", path(3000), { name: "Old Mill Trail (closed)" });
  auditCatalog([closed]);
  assert.ok(closed.row.flags!.includes("closed"));
  assert.equal(closed.row.quality, "review");
  assert.equal(filterCatalog([closed.row], {}).total, 0);
  assert.equal(filterCatalog([closed.row], { includeFragments: true }).total, 1);
});

test("conflicting sources: the mapped line wins and the disagreement is recorded", () => {
  const item = { ...trail("usgs-c2", path(1000)), sectionReportedMiles: 0.1 };
  auditCatalog([item]);
  assert.ok(item.row.flags!.includes("distance-mismatch"));
  assert.ok(Math.abs(item.row.miles! * MILE_METERS - 1000) < 5, "stored miles stay the mapped length");
});

test("fragment parents need the parent to be clearly longer", () => {
  const parents = findFragmentParents([
    { id: "a", key: "US:x", miles: 1, lines: north(0, 1600), bounds: measureLines(north(0, 1600)).bounds },
    { id: "b", key: "US:x", miles: 0.8, lines: north(2000, 3300), bounds: measureLines(north(2000, 3300)).bounds },
  ]);
  assert.equal(parents.size, 0);
});

test("short distances show meters instead of <0.1 mi", () => {
  assert.equal(formatDistance(100 / MILE_METERS).primary, "100 m");
  assert.equal(formatDistance(2).primary, "2.0 mi");
  assert.equal(formatDistance(2).secondary, "3.2 km");
});

import { PisteIndex, matchSkiRun, type SkiRun } from "./ski-runs";
import { matchesCatalogActivity } from "./activity";

const piste = (uses: string[], lines: Lines, name = "Upper Kachina"): SkiRun => ({ name, uses, difficulty: "intermediate", areaId: "a", areaName: "Attitash", lines });

test("a trail drawn along a downhill piste is a ski run and leaves hiking results", () => {
  const index = new PisteIndex([piste(["downhill"], north(0, 1500))]);
  const lines: Lines = [[[-105.0001, 40], [-105.0001, 40 + 1500 / 111_195]]];
  const match = matchSkiRun("Kachina", lines, index)!;
  assert.equal(match.use, "downhill");
  assert.equal(match.areaName, "Attitash");
  const row = { ...base, name: "Kachina", miles: 0.9, winterUse: match.use };
  assert.equal(matchesCatalogActivity(row, "hike"), false);
  assert.equal(matchesCatalogActivity(row, "ski"), true);
  assert.equal(filterCatalog([row], {}).total, 0);
  assert.equal(filterCatalog([row], { activity: "ski" }).total, 1);
});

test("a summer trail that switchbacks across pistes stays a hiking trail", () => {
  const index = new PisteIndex([piste(["downhill"], north(0, 1500))]);
  const zigzag: Lines = [[]];
  for (let i = 0; i <= 12; i++) zigzag[0].push([-105 + (i % 2 ? 0.003 : -0.003), 40 + (i * 120) / 111_195]);
  assert.equal(matchSkiRun("Wildflower Loop", zigzag, index), null);
});

test("a foot-trail name on a piste and a Nordic track both stay hikeable", () => {
  const downhill = new PisteIndex([piste(["downhill"], north(0, 1500))]);
  assert.equal(matchSkiRun("Summit Hiking Trail", north(0, 1500), downhill), null);
  const nordic = new PisteIndex([piste(["nordic"], north(0, 1500), "Stream Loop")]);
  const match = matchSkiRun("Stream Loop", north(0, 1500), nordic)!;
  assert.equal(match.use, "nordic");
  const row = { ...base, name: "Stream Loop", miles: 0.9, winterUse: match.use };
  assert.equal(matchesCatalogActivity(row, "hike"), true);
  assert.equal(matchesCatalogActivity(row, "ski"), true);
});

import { chooseStart, googleMapsDirectionsUrl, onTrailInstructions, stepInstruction, trailEnds } from "./access";

test("start point prefers a mapped trailhead, then parking, then the trail end", () => {
  const lines = north(0, 1600);
  const ends = trailEnds(lines)!;
  const parking = { kind: "parking" as const, name: "Lot", latitude: 40, longitude: -105.001, toTrailMeters: 85 };
  const trailhead = { kind: "trailhead" as const, name: "Ridge TH", latitude: 40, longitude: -105.003, toTrailMeters: 250 };
  assert.equal(chooseStart(ends, [parking, trailhead]).name, "Ridge TH");
  assert.equal(chooseStart(ends, [parking]).name, "Lot");
  assert.equal(chooseStart(ends, []).kind, "trail-end");
});

test("on-trail instructions give direction, length and the way back", () => {
  const lines = north(0, 1609);
  const start = { kind: "trailhead" as const, name: "Ridge TH", latitude: 40, longitude: -105.002, toTrailMeters: 170 };
  const steps = onTrailInstructions("Ridge Trail", 1, lines, start);
  assert.equal(steps[0], "Start at Ridge TH.");
  assert.match(steps[1], /Walk about .* east to reach Ridge Trail/);
  assert.match(steps[2], /Follow Ridge Trail north for 1\.0 mi/);
  assert.match(steps[3], /2\.0 mi round trip/);
  const loop: Lines = [[[-105, 40], [-105, 40.005], [-104.995, 40.005], [-104.995, 40], [-105, 40]]];
  assert.match(onTrailInstructions("Pond Loop", 1.3, loop, chooseStart(trailEnds(loop)!, []))[1], /around the loop/);
});

test("driving steps read as instructions and Google links need no key", () => {
  assert.equal(stepInstruction({ name: "Main Street", distance: 100, duration: 10, maneuver: { type: "turn", modifier: "left" } }), "Turn left onto Main Street");
  assert.equal(stepInstruction({ name: "", distance: 0, duration: 0, maneuver: { type: "roundabout", exit: 2 } }), "At the roundabout, take the 2nd exit");
  assert.equal(googleMapsDirectionsUrl(40.1, -105.2), "https://www.google.com/maps/dir/?api=1&destination=40.1%2C-105.2&travelmode=driving");
});

import { routeSteps } from "./access";
test("repeated continue steps are combined and ramps read naturally", () => {
  const step = (type: string, name: string, distance: number, modifier?: string) => ({ name, distance, duration: 1, maneuver: { type, modifier } });
  const steps = routeSteps([step("continue", "US 66", 100), step("new name", "US 66", 200), step("on ramp", "I 40", 50, "straight")]);
  assert.deepEqual(steps.map((s) => s.instruction), ["Continue on US 66", "Take the ramp onto I 40"]);
  assert.equal(steps[0].distanceMeters, 300);
});

import { isSidewalkName } from "./quality";
test("sidewalks and road sidepaths leave hiking results; named walks like riverwalks stay", () => {
  for (const name of ["Coral Way Sidepath", "Bloor St W Cycle Track", "Sidewalk or Pathway", "5th St.", "Main Street", "City of Windsor Bike Lanes"]) assert.equal(isSidewalkName(name, 1), true, name);
  for (const name of ["Miami Riverwalk", "Hudson River Waterfront Walkway", "Stone Harbor Promenade", "Jordan River Parkway", "Old Tioga Road", "The Boulevard", "Bill's Boulevard", "Main Street Trail"]) assert.equal(isSidewalkName(name, 1), false, name);
  assert.equal(isSidewalkName("Wall Street", 1, "Bureau of Land Management"), false, "wildland nickname");
  assert.equal(isSidewalkName("Walking Path", 0.2), true, "short generic path");
  assert.equal(isSidewalkName("Walking Path", 2), false, "long generic path stays");

  const sidepath = trail("usgs-sp", path(1500), { name: "Coral Way Sidepath" });
  const riverwalk = trail("usgs-rw", path(1500), { name: "Miami Riverwalk" });
  auditCatalog([sidepath, riverwalk]);
  assert.ok(sidepath.row.flags!.includes("sidewalk"));
  assert.deepEqual(filterCatalog([sidepath.row, riverwalk.row], {}).trails.map((t) => t.id), ["usgs-rw"]);
  assert.equal(filterCatalog([sidepath.row], { activity: "bike" }).total, 1, "sidepaths stay listed for biking");
  assert.equal(filterCatalog([sidepath.row], { includeFragments: true }).total, 1);
});

import { LineIndex, classifyTerrain, pointsAlong, surroundingPoints } from "./additions";
test("a new line already in the catalog is a duplicate; a new one is not", () => {
  const index = new LineIndex();
  index.add(north(0, 2000));
  assert.ok(index.coveredShare([[[-105.0001, 40], [-105.0001, 40 + 1500 / 111_195]]]) > 0.95, "10 m offset copy");
  assert.equal(index.coveredShare(north(0, 1500, -105.01)), 0, "parallel line 850 m away");
});

test("mountain terrain needs relief around the trail or a real climb; flat land is not mountain", () => {
  assert.equal(classifyTerrain([2400, 2410, 2420], [2300, 2550, 2450, 2380]).mountain, true, "valley floor among peaks");
  assert.equal(classifyTerrain([300, 330, 365], [300, 310, 320, 330]).mountain, true, "trail climbs 65 m");
  assert.equal(classifyTerrain([1610, 1615, 1612], [1600, 1620, 1605, 1618]).mountain, false, "high plains are not mountains");
  assert.equal(classifyTerrain([], []).mountain, false, "no elevation data is never assumed mountain");
  const points = pointsAlong(north(0, 1000), 5);
  assert.equal(points.length, 2, "a two-point line returns its points");
  assert.equal(surroundingPoints([-105, 40]).length, 4);
});

import { buildResortOverlay, type ResortTrailSource } from "./resorts";
test("resort-listed trails: stated lengths, no invented route, no duplicates of mapped trails", () => {
  const source: ResortTrailSource = {
    resort: "Taos Ski Valley", state: "New Mexico", baseLatitude: 36.596, baseLongitude: -105.454, coordinatesSource: "https://example.org", sourceUrl: "https://example.org/summer", season: "2025 summer",
    trails: [
      { name: "Williams Lake Trail", miles: 3.7, lengthBasis: "round-trip", difficulty: "moderate", use: "hike", quote: "Williams Lake Trail 3.7 mi" },
      { name: "Bavarian Loop", miles: 1.1, lengthBasis: "loop", difficulty: null, use: "hike+bike", quote: "Bavarian Loop 1.1 mi" },
      { name: "Kachina Spur", miles: 0.2, lengthBasis: "one-way", difficulty: null, use: "hike", quote: "0.2 mi" },
    ],
  };
  const mapped = { ...base, id: "usgs-wl", name: "WILLIAMS LAKE TR", region: "New Mexico", latitude: 36.58, longitude: -105.44 };
  const rows = buildResortOverlay([source], [mapped]);
  assert.deepEqual(rows.map((r) => r.name), ["Bavarian Loop"], "mapped duplicate and <0.3 mi entries are dropped");
  const [row] = rows;
  assert.equal(row.miles, 1.1);
  assert.equal(row.distanceBasis, "source");
  assert.equal(row.source, "resort");
  assert.match(row.note!, /isn’t drawn/);
  assert.equal(filterCatalog([row], {}).total, 1, "a summer resort trail stays in hiking results despite 'Ski' in the resort name");
  assert.equal(filterCatalog([row], { activity: "bike" }).total, 1, "multi-use resort trails are listed for biking too");
});

import { isMotorizedName } from "./quality";
test("ATV, OHV, motorcycle and 4x4 routes leave hiking results; 'No OHV' trails stay", () => {
  for (const name of ["Turkey Point ATV Trail", "Foreman Lake Motorcycle Trail", "PIPELINE 4X4 CHALLENGE TRAIL", "HULL CREEK OHV - ATV", "Jeep Trail"]) assert.equal(isMotorizedName(name), true, name);
  for (const name of ["CHERRY LAKE NO OHV-ATV", "Non-motorized Loop", "Ridge Trail", "Mount Atvist Trail"]) assert.equal(isMotorizedName(name), false, name);
  const atv = trail("usgs-atv", path(3000), { name: "Turkey Point ATV Trail" });
  auditCatalog([atv]);
  assert.ok(atv.row.flags!.includes("motorized"));
  assert.equal(filterCatalog([atv.row], {}).total, 0);
  assert.equal(filterCatalog([atv.row], { activity: "all" }).total, 1);
});

import { normalizeSeason, trailStatusFor } from "./agencies";
test("USGS season codes: No and Unknown mean no season; Yes and descriptions mean seasonal", () => {
  assert.equal(normalizeSeason("No"), null);
  assert.equal(normalizeSeason("Unknown"), null);
  assert.equal(normalizeSeason("Yes"), "Seasonal");
  assert.equal(normalizeSeason("Open March 1 to November 30"), "Open March 1 to November 30");
  assert.equal(trailStatusFor({ season: "No", flags: [] }), "UNKNOWN");
  assert.equal(trailStatusFor({ season: "Closed 12/15-7/15", flags: [] }), "SEASONAL");
  assert.equal(trailStatusFor({ season: null, flags: ["closed"] }), "CLOSED");
});

import { resortSeasonLabel } from "./resorts";
test("resort season notes become short labels", () => {
  assert.equal(resortSeasonLabel("2025 summer (hiking map dated 2025-07)"), "2025 summer listing");
  assert.equal(resortSeasonLabel("current (fetched 2026)"), "2026 summer listing");
  assert.equal(resortSeasonLabel("current summer (page undated)"), "undated page");
});

import { winterVerdict } from "./winter-audit";
test("second winter pass: lift lines, USFS snow routes and winter names leave hiking; summer trails stay", () => {
  const empty = new PisteIndex([]);
  const line = north(0, 1500);
  assert.equal(winterVerdict({ name: "CHAIR LIFT" }, line, empty, empty, null)?.use, "downhill");
  assert.equal(winterVerdict({ name: "2730-240 SPUR SNOW" }, line, empty, empty, null)?.use, "oversnow");
  assert.equal(winterVerdict({ name: "Snow Lake Trail" }, line, empty, empty, null), null, "place names with Snow stay");
  const snow = new LineIndex();
  snow.add(line, "usfs-snow-1");
  assert.equal(winterVerdict({ name: "Ridge Road" }, line, empty, empty, snow)?.use, "oversnow");
  assert.equal(winterVerdict({ name: "Ridge Trail", sources: [{ type: "USFS_OFFICIAL", id: "1", url: "", name: "Ridge Trail" }] }, line, empty, empty, snow), null, "a USFS hiking record keeps it hikeable");
  const row = { ...base, name: "Ridge Road", miles: 1, winterUse: "oversnow" as const };
  assert.equal(filterCatalog([row], {}).total, 0);
  assert.equal(filterCatalog([row], { activity: "ski" }).total, 1);
});

import { trailActivities, sectionOf } from "./activity";
test("sections: official uses add biking and horses without removing hiking; surfaces split mountain from path biking", () => {
  const shared = { ...base, name: "Ridge Trail", miles: 4, uses: ["Hiking", "Bikes", "Horses"] };
  assert.deepEqual(trailActivities(shared).filter((a) => ["hike", "bike", "mtb", "horse"].includes(a)).sort(), ["bike", "hike", "horse", "mtb"]);
  // Bikes allowed, hikers not recorded either way: still a hike.
  assert.ok(trailActivities({ ...base, name: "Ridge Trail", miles: 4, uses: ["Bikes"] }).includes("hike"));
  const railTrail = { ...base, name: "Old Mill Rail Trail", miles: 6, surface: "Crushed stone" };
  assert.ok(trailActivities(railTrail).includes("path-bike"));
  assert.ok(!trailActivities(railTrail).includes("mtb"));
  const boardwalk = { ...base, name: "Bobcat Boardwalk", miles: 0.6 };
  assert.ok(trailActivities(boardwalk).includes("walk"));
  assert.ok(!trailActivities({ ...base, name: "Summit Ridge Trail", miles: 6 }).includes("walk"));
  // USGS says no hikers: out of foot sections, still listed for its allowed uses.
  const noHikers = { ...base, name: "Pine Loop", miles: 3, uses: ["Bikes"], flags: ["no-hiking" as const] };
  assert.equal(filterCatalog([noHikers], {}).total, 0);
  assert.equal(filterCatalog([noHikers], { activity: "mtb" }).total, 1);
  assert.equal(sectionOf("path-bike").key, "bike");
  assert.equal(sectionOf(undefined).key, "foot");
});
