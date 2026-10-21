import assert from "node:assert/strict";
import test from "node:test";
import { localTrailsVisible, MAP_TRAIL_LIMIT, TRAIL_CARD_LIMIT, readableTrailName } from "./discovery";
test("local trails appear only after zooming in", () => {
  assert.equal(localTrailsVisible(3.6), false);
  assert.equal(localTrailsVisible(10.9), false);
  assert.equal(localTrailsVisible(11), true);
  assert.equal(localTrailsVisible(15), true);
});
test("discovery displays a small bounded selection", () => {
  assert.equal(MAP_TRAIL_LIMIT, 24);
  assert.equal(TRAIL_CARD_LIMIT, 6);
});
test("unnamed source trails never acquire an invented official name", () => {
  assert.equal(readableTrailName("Half Dome Trail", "nps-123456"), "Half Dome Trail");
  assert.equal(readableTrailName("<unnamed>", "usgs-123456"), "Unnamed trail · 123456");
});