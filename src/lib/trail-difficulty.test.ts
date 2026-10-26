import test from "node:test";
import assert from "node:assert/strict";
import { computeDifficulty, naismithHours, normalizeDifficulty, trailDifficulty } from "./trail-difficulty";

test("computeDifficulty: effort = miles + climb ÷ 500; Easy < 4, Moderate 4–8, Hard 8–14, Expert > 14", () => {
  assert.equal(computeDifficulty({ lengthMi: 2, gainFt: 300 }), "easy"); // 2.6
  assert.equal(computeDifficulty({ lengthMi: 4, gainFt: 600 }), "moderate"); // 5.2, 150 ft/mi
  assert.equal(computeDifficulty({ lengthMi: 7, gainFt: 1500 }), "hard"); // 10
  assert.equal(computeDifficulty({ lengthMi: 12, gainFt: 2000 }), "expert"); // 16
  assert.equal(computeDifficulty({ lengthMi: null }), null);
});

test("Yosemite Falls Trail is Hard, Lower Yosemite Fall is Easy, 20 mi / 5,000 ft is Expert", () => {
  assert.equal(computeDifficulty({ lengthMi: 3.0, gainFt: 3027, maxElevFt: 6639 }), "hard");
  assert.equal(computeDifficulty({ lengthMi: 1.1, gainFt: 100, maxElevFt: 4000 }), "easy");
  assert.equal(computeDifficulty({ lengthMi: 20, gainFt: 5000 }), "expert");
});

test("steep or high trails go up one level (not past Hard); more than 2,000 ft of climb is never Easy", () => {
  assert.equal(computeDifficulty({ lengthMi: 1, gainFt: 900 }), "moderate"); // effort 2.8, 900 ft/mi → bump
  assert.equal(computeDifficulty({ lengthMi: 2, gainFt: 200, maxElevFt: 11_000 }), "moderate"); // high
  assert.equal(computeDifficulty({ lengthMi: 0.5, gainFt: 2100, maxElevFt: 3000 }), "hard"); // 4.7, 4,200 ft/mi → bump
  assert.equal(computeDifficulty({ lengthMi: 10, gainFt: 1500, maxElevFt: 12_000 }), "hard"); // 13 + high → stays Hard
});

test("catalog trails are rated from their stored measures; unknown length reads Moderate", () => {
  assert.equal(trailDifficulty({ miles: 3.014, gainFt: 3101, maxElevFt: 6638 }), "hard");
  assert.equal(trailDifficulty({ miles: null }), "moderate");
});

test("naismithHours: 3 mph plus an hour per 2,000 ft; none without a climb or over 50 miles", () => {
  assert.equal(naismithHours(6, 2000), 3);
  assert.equal(naismithHours(6, null), null);
  assert.equal(naismithHours(60, 1000), null);
});

test("normalizeDifficulty reads source wording", () => {
  assert.equal(normalizeDifficulty("Strenuous"), "hard");
  assert.equal(normalizeDifficulty("beginner"), "easy");
  assert.equal(normalizeDifficulty(""), null);
});
