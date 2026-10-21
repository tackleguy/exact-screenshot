import type * as maplibregl from "maplibre-gl";
import { loadOpenTrailMapStyle } from "@/lib/opentrailmap";

export type Basemap = "topo" | "satellite" | "hybrid";

export const TERRAIN_SOURCE: maplibregl.RasterDEMSourceSpecification = {
  type: "raster-dem",
  tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
  encoding: "terrarium",
  tileSize: 256,
  maxzoom: 15,
  attribution: "Terrain © Mapzen, AWS Terrain Tiles",
};

/** Trail colours by difficulty letter (e/m/h/x), shared by pins, lines and card badges. */
export const DIFFICULTY_COLORS: Record<string, string> = { e: "#2f9e5b", m: "#2f7fd8", h: "#d8452f", x: "#1d1d1d" };
export const DIFFICULTY_LABELS: Record<string, string> = { e: "Easy", m: "Moderate", h: "Hard", x: "Expert" };
export const SELECTED_COLOR = "#ffc21a";
const FONT = ["Americana-Bold"];

const difficultyColor: maplibregl.ExpressionSpecification = [
  "match", ["get", "d"],
  "e", DIFFICULTY_COLORS.e,
  "h", DIFFICULTY_COLORS.h,
  "x", DIFFICULTY_COLORS.x,
  DIFFICULTY_COLORS.m,
];

/**
 * OpenTrailMap colours paths by access rules (magenta for unknown, red for restricted). On a consumer
 * map every OpenStreetMap path reads as a fine dashed topo line; Hyked trails draw over them.
 */
function topoPaths(style: maplibregl.StyleSpecification): maplibregl.StyleSpecification {
  const layers = style.layers.flatMap((layer): maplibregl.LayerSpecification[] => {
    if (layer.type !== "line" || !("source" in layer) || layer.source !== "trails") return [layer];
    if (/waterway/.test(layer.id) || /^(hovered|selected)-/.test(layer.id)) return [];
    if (!/paths/.test(layer.id)) return [layer];
    const informal = /informal|disallowed/.test(layer.id);
    return [{
      ...layer,
      minzoom: 11,
      paint: {
        "line-color": "#8c4a32",
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.7, 14, 1.4, 18, 3],
        "line-dasharray": [2.4, 1.6],
        "line-opacity": informal ? 0.45 : 0.85,
      },
    }];
  });
  return { ...style, layers, sources: { ...style.sources, terrain: TERRAIN_SOURCE } };
}

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";

function rasterStyle(basemap: "satellite" | "hybrid", glyphs?: string): maplibregl.StyleSpecification {
  const sources: maplibregl.StyleSpecification["sources"] = {
    terrain: TERRAIN_SOURCE,
    satellite: { type: "raster", tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19, attribution: "Imagery © Esri, Maxar, Earthstar Geographics" },
  };
  const layers: maplibregl.LayerSpecification[] = [{ id: "satellite", type: "raster", source: "satellite" }];
  if (basemap === "hybrid") {
    sources.roads = { type: "raster", tiles: [`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19 };
    sources.labels = { type: "raster", tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19 };
    layers.push({ id: "roads", type: "raster", source: "roads" }, { id: "labels", type: "raster", source: "labels" });
  }
  return { version: 8, glyphs: glyphs ?? "https://font.americanamap.org/{fontstack}/{range}.pbf", sources, layers };
}

export async function explorerStyle(basemap: Basemap): Promise<maplibregl.StyleSpecification | string> {
  if (basemap !== "topo") return rasterStyle(basemap);
  try {
    return topoPaths(await loadOpenTrailMapStyle("trail"));
  } catch {
    // OpenTrailMap is down: imagery still gives a usable map with Hyked trails on top.
    return rasterStyle("hybrid");
  }
}

export const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** Hyked's own sources and layers; re-installed after every basemap switch. */
export function installOverlay(map: maplibregl.Map, data: { pins: GeoJSON.FeatureCollection; grid: GeoJSON.FeatureCollection; lines: GeoJSON.FeatureCollection; selected: GeoJSON.FeatureCollection; drive: GeoJSON.FeatureCollection }) {
  if (map.getSource("hy-pins")) return;
  map.addSource("hy-lines", { type: "geojson", data: data.lines });
  map.addSource("hy-drive", { type: "geojson", data: data.drive });
  map.addSource("hy-selected", { type: "geojson", data: data.selected });
  map.addSource("hy-grid", { type: "geojson", data: data.grid });
  map.addSource("hy-pins", { type: "geojson", data: data.pins, cluster: true, clusterRadius: 46, clusterMaxZoom: 10 });

  map.addLayer({ id: "hy-drive-casing", type: "line", source: "hy-drive", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#0b2a4a", "line-width": 8, "line-opacity": 0.5 } });
  map.addLayer({ id: "hy-drive", type: "line", source: "hy-drive", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#3a8dff", "line-width": 4.5 } });

  map.addLayer({ id: "hy-lines-casing", type: "line", source: "hy-lines", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#14110f", "line-opacity": 0.55, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 3, 13, 6, 17, 10] } });
  map.addLayer({
    id: "hy-lines", type: "line", source: "hy-lines", layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": difficultyColor,
      "line-width": ["interpolate", ["linear"], ["zoom"], 9, ["case", ["boolean", ["feature-state", "hover"], false], 3, 1.6], 13, ["case", ["boolean", ["feature-state", "hover"], false], 5.5, 3.5], 17, 7],
    },
  });
  map.addLayer({ id: "hy-selected-casing", type: "line", source: "hy-selected", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#1a1405", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 6, 14, 11, 18, 15] } });
  map.addLayer({ id: "hy-selected", type: "line", source: "hy-selected", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": SELECTED_COLOR, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3.5, 14, 6.5, 18, 9] } });
  map.addLayer({
    id: "hy-lines-label", type: "symbol", source: "hy-lines", minzoom: 12.5,
    layout: { "symbol-placement": "line", "text-field": ["get", "name"], "text-font": FONT, "text-size": 12, "text-max-angle": 30, "symbol-spacing": 320 },
    paint: { "text-color": "#1d1a16", "text-halo-color": "#fffdf7", "text-halo-width": 1.8 },
  });

  for (const source of ["hy-grid", "hy-pins"] as const) {
    const filter: maplibregl.FilterSpecification = source === "hy-pins" ? ["has", "point_count"] : ["has", "count"];
    const count: maplibregl.ExpressionSpecification = source === "hy-pins" ? ["get", "point_count"] : ["get", "count"];
    map.addLayer({
      id: `${source}-cluster`, type: "circle", source, filter,
      paint: {
        "circle-color": "#12211b",
        "circle-opacity": 0.92,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-radius": ["step", count, 15, 25, 18, 100, 22, 1000, 27, 10000, 32],
      },
    });
    map.addLayer({
      id: `${source}-count`, type: "symbol", source, filter,
      layout: { "text-field": ["case", [">=", count, 1000], ["concat", ["to-string", ["round", ["/", count, 100]]], "00+"], ["to-string", count]], "text-font": FONT, "text-size": 12.5, "text-allow-overlap": true },
      paint: { "text-color": "#ffffff" },
    });
  }
  map.addLayer({
    id: "hy-pin", type: "circle", source: "hy-pins", filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": difficultyColor,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 5, 10, 7, 14, 6],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
      "circle-opacity": ["interpolate", ["linear"], ["zoom"], 12, 1, 15, 0.85],
    },
  });
  map.addLayer({
    id: "hy-pin-selected", type: "circle", source: "hy-pins", filter: ["==", ["get", "id"], ""],
    paint: { "circle-color": SELECTED_COLOR, "circle-radius": 10, "circle-stroke-color": "#1a1405", "circle-stroke-width": 3 },
  });
}

export function setSky(map: maplibregl.Map, on: boolean) {
  try {
    map.setSky(on ? { "sky-color": "#a9cbe8", "horizon-color": "#eef1ea", "fog-color": "#eef1ea", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.7, "fog-ground-blend": 0.25, "atmosphere-blend": 0.6 } : {});
  } catch {
    /* sky is cosmetic */
  }
}
