import test from "node:test";
import assert from "node:assert/strict";
import { bridgeTrailGaps, trailGaps } from "./bridge";
import { resetNetworkCache } from "./index";
import type { LngLat, NetworkTrail } from "./graph";

// A trail mapped in two pieces with a ~180 m gap between them (east-west, at 37° N).
const east = (from: number, to: number, y = 37): LngLat[] => Array.from({ length: to - from + 1 }, (_, i) => [-119 + (from + i) * 0.0005, y]);
const pieceA = east(0, 20), pieceB = east(24, 44);

test("gaps between a trail's pieces are measured after laying them end to end", () => {
  const gaps = trailGaps([pieceB, pieceA]);
  assert.equal(gaps.length, 1);
  assert.ok(gaps[0].meters > 150 && gaps[0].meters < 200, `${gaps[0].meters}`);
  assert.equal(trailGaps([east(0, 20), east(20, 40)]).length, 0, "touching pieces have no gap");
});

test("a gap is joined along a real mapped path; with none, it stays a gap", async () => {
  const trail: NetworkTrail = { id: "t", name: "Trail", quality: 1, tier: null, lines: [pieceA, pieceB] };
  // Another mapped path covering the gap.
  const connector: NetworkTrail = { id: "c", name: "Connector", quality: 1, tier: null, lines: [east(18, 26)] };
  resetNetworkCache();
  const joined = await bridgeTrailGaps([pieceA, pieceB], { load: async () => [trail, connector] });
  assert.equal(joined.gaps, 1);
  assert.equal(joined.links.length, 1);
  assert.equal(joined.sections, 1);
  resetNetworkCache();
  const alone = await bridgeTrailGaps([pieceA, pieceB], { load: async () => [trail] });
  assert.equal(alone.links.length, 0, "nothing drawn across open ground");
  assert.equal(alone.sections, 2);
});
