import test from "node:test";
import assert from "node:assert/strict";
import type * as maplibreTypes from "maplibre-gl";
import { AERO_LAYER_IDS, buildAeronauticalStyle, FAA_CHARTS } from "./aero-charts";

const MOCK_DEM: Record<string, maplibreTypes.SourceSpecification> = {
  "terrain-dem": { type: "raster-dem", tiles: ["https://example.com/{z}/{x}/{y}.png"], tileSize: 256 },
  "hillshade-dem": { type: "raster-dem", tiles: ["https://example.com/{z}/{x}/{y}.png"], tileSize: 256 },
};
const MOCK_HILLSHADE: maplibreTypes.LayerSpecification = {
  id: "hillshade",
  type: "hillshade",
  source: "hillshade-dem",
};

test("buildAeronauticalStyle builds 3D DEM + FAA VFR Sectional and Terminal Area layers", () => {
  const vfr = buildAeronauticalStyle("vfr", MOCK_DEM, { hillshade: MOCK_HILLSHADE }, 0.82);
  assert.equal(vfr.version, 8);
  assert.ok("terrain-dem" in vfr.sources, "Expected terrain-dem source for 3D relief");

  const sectional = vfr.sources["aero-vfr-sectional"] as { tiles: string[]; minzoom: number; maxzoom: number };
  const terminal = vfr.sources["aero-vfr-terminal"] as { tiles: string[]; minzoom: number; maxzoom: number };
  assert.deepEqual(sectional.tiles, [FAA_CHARTS.vfrSectional]);
  assert.equal(sectional.minzoom, 8);
  assert.equal(sectional.maxzoom, 12);
  assert.deepEqual(terminal.tiles, [FAA_CHARTS.vfrTerminal]);
  assert.equal(terminal.minzoom, 10);
  assert.equal(terminal.maxzoom, 12);

  const secLayer = vfr.layers.find((l) => l.id === "aero-vfr-sectional") as { paint?: Record<string, unknown> };
  assert.ok(secLayer);
  assert.equal(secLayer.paint?.["raster-opacity"], 0.82);
});

test("buildAeronauticalStyle builds 3D DEM + FAA IFR Enroute High and Low layers and clamps opacity", () => {
  const ifr = buildAeronauticalStyle("ifr", MOCK_DEM, { hillshade: MOCK_HILLSHADE }, 0.1);
  assert.equal(ifr.version, 8);
  assert.ok("terrain-dem" in ifr.sources, "Expected terrain-dem source for 3D relief");

  const high = ifr.sources["aero-ifr-high"] as { tiles: string[]; minzoom: number; maxzoom: number };
  const low = ifr.sources["aero-ifr-low"] as { tiles: string[]; minzoom: number; maxzoom: number };
  assert.deepEqual(high.tiles, [FAA_CHARTS.ifrHigh]);
  assert.equal(high.minzoom, 5);
  assert.equal(high.maxzoom, 9);
  assert.deepEqual(low.tiles, [FAA_CHARTS.ifrLow]);
  assert.equal(low.minzoom, 7);
  assert.equal(low.maxzoom, 12);

  const lowLayer = ifr.layers.find((l) => l.id === "aero-ifr-low") as { paint?: Record<string, unknown> };
  assert.ok(lowLayer);
  assert.equal(lowLayer.paint?.["raster-opacity"], 0.35);
  assert.equal(AERO_LAYER_IDS.length, 8);
});
