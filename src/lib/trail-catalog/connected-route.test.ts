import test from "node:test";
import assert from "node:assert/strict";
import { connectedRoute, connectedGpx } from "./connected-route";
test("point-to-point follows two trails through their shared junction", () => {
  const route = connectedRoute([{ id: "a", name: "A", lines: [[[0, 0], [0, 0.01], [0.01, 0.01]]] }, { id: "b", name: "B", lines: [[[0, 0.01], [-0.01, 0.01]]] }], [0, 0], [-0.01, 0.01]);
  assert.deepEqual(route.coordinates, [[0, 0], [0, 0.01], [-0.01, 0.01]]);
  assert.ok(route.meters > 2200 && route.meters < 2230);
});
test("nearby disconnected trails never get a fabricated connector", () => {
  assert.throws(() => connectedRoute([{ id: "a", name: "A", lines: [[[0, 0], [0, 0.01]]] }, { id: "b", name: "B", lines: [[[0.0001, 0.01], [0.01, 0.01]]] }], [0, 0], [0.01, 0.01]), /No mapped connection/);
});
test("GPX retains the point-to-point route coordinates", () => {
  assert.match(connectedGpx([[-119, 37], [-118, 38]]), /lat="37" lon="-119"/);
});