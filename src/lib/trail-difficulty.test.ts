import test from "node:test";
import assert from "node:assert/strict";
import {
  averageDifficulties,
  computeDifficulty,
  naismithHours,
  normalizeDifficulty,
  resolveDifficulty,
} from "./trail-difficulty";

test("normalizeDifficulty maps common trail language", () => {
  assert.equal(normalizeDifficulty("Easy"), "easy");
  assert.equal(normalizeDifficulty("strenuous"), "hard");
  assert.equal(normalizeDifficulty("YDS 4 scramble"), "expert");
  assert.equal(normalizeDifficulty(""), null);
});

test("computeDifficulty: effort = miles + 2 × thousands of feet climbed, with an OSM sac_scale floor", () => {
  assert.equal(computeDifficulty({ miles: 1.2, gainFt: 80 }), "easy");
  assert.equal(computeDifficulty({ miles: 3, gainFt: 1000 }), "moderate"); // 5
  assert.equal(computeDifficulty({ miles: 8, gainFt: 2000 }), "hard"); // 12
  assert.equal(computeDifficulty({ miles: 14, gainFt: 4800 }), "expert"); // 23.6
  assert.equal(computeDifficulty({ miles: 0.6, sacScale: "demanding_mountain_hiking" }), "hard");
  assert.equal(computeDifficulty({ miles: null }), null);
});

test("naismithHours: 3 mph plus an hour per 2,000 ft; none without a climb or over 50 miles", () => {
  assert.equal(naismithHours(6, 2000), 3);
  assert.equal(naismithHours(6, null), null);
  assert.equal(naismithHours(60, 1000), null);
});

test("resolveDifficulty prefers community average once five ratings exist", () => {
  const community = resolveDifficulty({
    reported: null,
    communityDifficulty: "hard",
    difficultyRatingCount: 5,
    miles: 2,
  });
  assert.equal(community.source, "community");
  assert.equal(community.difficulty, "hard");

  const computed = resolveDifficulty({
    reported: null,
    communityDifficulty: "hard",
    difficultyRatingCount: 3,
    miles: 2,
    gainFt: 100,
  });
  assert.equal(computed.source, "computed");
  assert.equal(computed.difficulty, "easy");
  assert.match(computed.label, /distance, climb/);
});

test("averageDifficulties rounds to the nearest band", () => {
  assert.equal(averageDifficulties(["easy", "easy", "moderate", "moderate", "hard"]), "moderate");
});
