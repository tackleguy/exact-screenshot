import test from "node:test";
import assert from "node:assert/strict";
import { Route } from "@/lib/geo/line";
import { profileFeetAt, TrackRecorder, type Fix } from "./gps-track";

const north = (i: number, meters: number) => 37 + (i * meters) / 111_000;
const fix = (i: number, step = 10, seconds = 10, extra: Partial<Fix> = {}): Fix => ({ lat: north(i, step), lng: -119, altitudeM: 1000, accuracyM: 8, time: i * seconds * 1000, ...extra });

test("weak, jittery and impossibly fast fixes are rejected", () => {
  const r = new TrackRecorder("hike");
  assert.equal(r.push(fix(0)), "accepted");
  assert.equal(r.push({ ...fix(1), accuracyM: 45 }), "weak");
  assert.equal(r.push({ ...fix(0), lat: north(0, 10) + 1e-5, time: 5000 }), "jitter"); // ~1 m away
  assert.equal(r.push({ ...fix(1, 500, 10) }), "too-fast"); // 500 m in 10 s ≈ 112 mph on foot
  assert.equal(r.push(fix(1)), "accepted");
  const bike = new TrackRecorder("bike");
  bike.push(fix(0));
  assert.equal(bike.push(fix(1, 120, 10)), "accepted"); // 27 mph is fine on a bike
});

test("distance sums smoothed accepted points only; standing still adds nothing", () => {
  const r = new TrackRecorder("hike");
  for (let i = 0; i <= 20; i++) r.push(fix(i));
  // 200 m walked: the smoothed path lags behind the last fix, and the total adds that last stretch back.
  assert.ok(Math.abs(r.totalDistanceM - 200) < 1, `${r.totalDistanceM}`);
  const before = r.distanceM;
  for (let i = 0; i < 30; i++) r.push({ ...fix(20), lat: north(20, 10) + (i % 2 ? 1e-5 : -1e-5), time: (210 + i) * 1000 });
  assert.equal(r.distanceM, before);
});

test("moving time leaves out stops longer than 30 s", () => {
  const r = new TrackRecorder("hike");
  for (let i = 0; i <= 6; i++) r.push(fix(i)); // 60 s walking
  r.push({ ...fix(6), lat: north(6, 10) + 4 / 111_000, time: 180_000 }); // 4 m in 120 s: a stop
  for (let i = 7; i <= 9; i++) r.push({ ...fix(i), time: 180_000 + (i - 6) * 10_000 }); // 30 s walking
  assert.equal(r.movingSec, 90);
});

test("elevation follows the trail's DEM profile within 25 m and counts climb with a 10 ft hysteresis", () => {
  const line: [number, number][] = Array.from({ length: 21 }, (_, i) => [-119, north(i, 10)]);
  const profile: [number, number][] = Array.from({ length: 21 }, (_, i) => [(i * 10) / 1609.344, 4000 + i * 5]); // +100 ft
  const r = new TrackRecorder("hike", { route: new Route([line]), profile });
  // GPS altitude jumps ±30 m, but the DEM profile is used on the trail.
  for (let i = 0; i <= 20; i++) r.push({ ...fix(i), altitudeM: 1200 + (i % 2 ? 30 : -30) });
  assert.ok(r.gainFt >= 80 && r.gainFt <= 100, `${r.gainFt}`);
  assert.equal(profileFeetAt(profile, 105), 4052.5);
});

test("off-trail alert after more than 50 m off the line for more than 30 s", () => {
  const line: [number, number][] = Array.from({ length: 21 }, (_, i) => [-119, north(i, 10)]);
  const r = new TrackRecorder("hike", { route: new Route([line]), profile: [[0, 4000], [0.2, 4000]] });
  const east = (i: number, off: number, t: number): Fix => ({ lat: north(i, 10), lng: -119 + off / 88_000, altitudeM: null, accuracyM: 5, time: t });
  r.push(east(0, 0, 0));
  for (let k = 1; k <= 10; k++) r.push(east(k, 150, k * 10_000));
  assert.equal(r.offTrail, true);
  r.push(east(11, 0, 120_000));
  for (let k = 12; k <= 16; k++) r.push(east(k, 0, k * 10_000));
  assert.equal(r.offTrail, false);
});
