import test from "node:test";
import assert from "node:assert/strict";
import { defaultUnits, formatDistance, formatDuration, formatDurationRange, formatElevation, formatGrade, formatPace, hikingHours, splitDescent } from "./units";

test("default units follow the browser language: en-US imperial, others metric", () => {
  assert.equal(defaultUnits("en-US"), "imperial");
  assert.equal(defaultUnits("en-GB"), "metric");
  assert.equal(defaultUnits("de-DE"), "metric");
});

test("short distances show feet (imperial) or metres (metric), never metres next to miles", () => {
  assert.equal(formatDistance(480 / 5280, "imperial"), "480 ft");
  assert.equal(formatDistance(0.3, "imperial"), "0.3 mi");
  assert.equal(formatDistance(12.4, "imperial"), "12 mi");
  assert.equal(formatDistance(146 / 1609.344, "metric"), "145 m");
  assert.equal(formatDistance(3, "metric"), "4.8 km");
  assert.equal(formatDistance(null, "metric"), null);
});

test("elevation, grade and duration", () => {
  assert.equal(formatElevation(3027, "imperial"), "3,027 ft");
  assert.equal(formatElevation(3027, "metric"), "923 m");
  assert.equal(formatGrade(24.4), "24%");
  assert.equal(formatGrade(72), "60%+ (estimated)");
  assert.equal(formatDuration(2.75), "2 h 45 min");
  assert.equal(formatDuration(0.04), "5 min");
  assert.equal(formatDurationRange(3, 3.9), "3–4 h");
  assert.equal(formatPace(1609.344, 1110, "imperial"), "18:30 /mi");
});

test("hiking time: Naismith with Langmuir's descent corrections", () => {
  assert.equal(hikingHours({ miles: 6, gainFt: 2000 }, "imperial"), 3); // 2 h + 1 h
  assert.equal(hikingHours({ miles: 6, gainFt: 2000, steepDescentFt: 1000 }, "imperial"), 4);
  assert.ok(Math.abs(hikingHours({ miles: 6, gainFt: 0, gentleDescentFt: 1000 }, "imperial")! - (2 - 1 / 6)) < 1e-9);
  assert.ok(Math.abs(hikingHours({ miles: 6.2137 }, "metric")! - 2) < 1e-3); // 10 km at 5 km/h
  assert.equal(hikingHours({ miles: null }), null);
  assert.deepEqual(splitDescent(1000, 12), { steepDescentFt: 0, gentleDescentFt: 1000 });
  assert.deepEqual(splitDescent(1000, 36), { steepDescentFt: 1000, gentleDescentFt: 0 });
});
