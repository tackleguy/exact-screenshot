import test from "node:test";
import assert from "node:assert/strict";
import { steepestGrade } from "./grade";

test("steepest grade is measured over 100 m after smoothing, so DEM stair-steps don't read as cliffs", () => {
  // A steady 10% climb sampled every 20 m, with ±4 m DEM noise on alternate samples.
  const along = Array.from({ length: 60 }, (_, i) => i * 20);
  const clean = along.map((d) => d * 0.1);
  const noisy = clean.map((m, i) => m + (i % 2 ? 4 : -4));
  assert.ok(Math.abs(steepestGrade(along, clean)! - 10) < 0.5);
  assert.ok(steepestGrade(along, noisy)! < 16, "noise doesn't inflate the grade far past the true 10%");
  assert.equal(steepestGrade([0, 20, 40], [0, 2, 4]), null, "shorter than one window");
});
