import test from "node:test";
import assert from "node:assert/strict";
import {
  averageDifficulties,
  estimateDifficulty,
  normalizeDifficulty,
  resolveDifficulty,
} from "./trail-difficulty";

test("normalizeDifficulty maps common trail language", () => {
  assert.equal(normalizeDifficulty("Easy"), "easy");
  assert.equal(normalizeDifficulty("strenuous"), "hard");
  assert.equal(normalizeDifficulty("YDS 4 scramble"), "expert");
  assert.equal(normalizeDifficulty(""), null);
});

test("estimateDifficulty uses distance and climb when source is blank", () => {
  assert.equal(estimateDifficulty({ miles: 1.2, elevationFt: 80, name: "Nature boardwalk" }), "easy");
  assert.equal(estimateDifficulty({ miles: 12, elevationFt: 3200, name: "Alpine summit ridge" }), "expert");
  assert.equal(estimateDifficulty({ miles: 5, elevationFt: 900, name: "Forest loop" }), "moderate");
  assert.equal(estimateDifficulty({ miles: 0.4, name: "Lakeshore Trail" }), "easy", "a short trail with no climb data is easy");
  assert.equal(estimateDifficulty({ miles: 0.6, elevationFt: 700, name: "Summit Trail" }), "hard", "a short steep summit trail is not");
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

  const estimated = resolveDifficulty({
    reported: null,
    communityDifficulty: "hard",
    difficultyRatingCount: 3,
    miles: 2,
    elevationFt: 100,
    name: "Meadow walk",
  });
  assert.equal(estimated.source, "estimated");
  assert.match(estimated.label, /3\/5/);
});

test("averageDifficulties rounds to the nearest band", () => {
  assert.equal(averageDifficulties(["easy", "easy", "moderate", "moderate", "hard"]), "moderate");
});
