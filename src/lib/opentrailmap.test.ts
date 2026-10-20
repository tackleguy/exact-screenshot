import test from "node:test";
import assert from "node:assert/strict";
import type { StyleSpecification } from "maplibre-gl";
import { sanitizeOpenTrailMapStyle } from "./opentrailmap";

test("drops trails layers whose source-layer is gone from OSM US tiles", () => {
  const style = {
    version: 8,
    sources: {},
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#fff" } },
      {
        id: "park-outline",
        type: "line",
        source: "trails",
        "source-layer": "park",
        paint: { "line-color": "#000" },
      },
      {
        id: "barrier_area",
        type: "fill",
        source: "trails",
        "source-layer": "barrier_area",
        paint: { "fill-color": "#ccc" },
      },
      {
        id: "paths",
        type: "line",
        source: "trails",
        "source-layer": "trail",
        paint: { "line-color": "#4f2e28" },
      },
      {
        id: "trail-pois",
        type: "symbol",
        source: "trails",
        "source-layer": "trail_poi",
        layout: {},
      },
      {
        id: "park-label",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "park",
        layout: {},
      },
    ],
  } as StyleSpecification;

  const next = sanitizeOpenTrailMapStyle(style);
  assert.deepEqual(
    next.layers?.map((layer) => layer.id),
    ["background", "paths", "trail-pois", "park-label"],
  );
});
