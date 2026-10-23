import type * as maplibreTypes from "maplibre-gl";
import * as maplibregl from "@/lib/maplibre";
import mlcontour from "maplibre-contour";
import { TRAIL_DETAIL_ZOOM } from "@/lib/trail-catalog/discovery";

/**
 * Basemaps (licences in DECISIONS.md):
 * - topo, standard, bright, light, dark: OpenFreeMap vector maps ("liberty", "bright", "positron", "dark";
 *   OpenMapTiles schema, © OpenStreetMap contributors); topo adds hillshading and contour lines computed in a web
 *   worker from AWS Terrain Tiles (Terrarium DEM).
 * - outdoors, terrain, relief, natgeo, satellite: Esri raster basemaps (World Topo, World Terrain Base, World
 *   Shaded Relief, National Geographic, World Imagery) with Esri's attribution; terrain, relief and hybrid add
 *   hillshading and contours from the same DEM.
 * - usgs, usgs-imagery: USGS The National Map (U.S. only, public domain).
 */
export type Basemap = "topo" | "outdoors" | "terrain" | "relief" | "natgeo" | "usgs" | "usgs-imagery" | "satellite" | "hybrid" | "standard" | "bright" | "light" | "dark";

/** Every basemap with its picker label, hint and swatch (a tile of Yosemite Valley, or a CSS pattern). */
export const BASEMAPS: readonly { key: Basemap; label: string; hint: string }[] = [
  { key: "topo", label: "Topo", hint: "Contours and terrain shading" },
  { key: "outdoors", label: "Outdoors", hint: "Topographic map with trails and relief" },
  { key: "terrain", label: "Terrain", hint: "Landforms, shading and contours" },
  { key: "relief", label: "Shaded relief", hint: "Mountains and valleys in relief" },
  { key: "natgeo", label: "National Geographic", hint: "Classic atlas style" },
  { key: "usgs", label: "USGS Topo", hint: "U.S. government topo maps (U.S. only)" },
  { key: "usgs-imagery", label: "USGS Imagery Topo", hint: "Aerial photos with topo lines (U.S. only)" },
  { key: "satellite", label: "Satellite", hint: "Aerial imagery with roads" },
  { key: "hybrid", label: "Satellite + contours", hint: "Imagery with contour lines" },
  { key: "standard", label: "Standard", hint: "Streets and places" },
  { key: "bright", label: "Bright", hint: "Colourful streets and parks" },
  { key: "light", label: "Light", hint: "Quiet grey map that lets trails stand out" },
  { key: "dark", label: "Dark", hint: "Night-friendly dark map" },
];

const TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const OPENFREEMAP = "https://tiles.openfreemap.org/styles";
const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

export const TERRAIN_SOURCE: maplibreTypes.RasterDEMSourceSpecification = {
  type: "raster-dem",
  tiles: [TERRARIUM],
  encoding: "terrarium",
  tileSize: 256,
  maxzoom: 15,
  attribution: "Terrain: <a href=\"https://registry.opendata.aws/terrain-tiles/\">AWS Terrain Tiles</a> (USGS 3DEP, SRTM)",
};

/** Trail colours by difficulty letter (e/m/h/x), shared by pins, lines and card badges. */
export const DIFFICULTY_COLORS: Record<string, string> = { e: "#2f9e5b", m: "#2f7fd8", h: "#d8452f", x: "#1d1d1d" };
export const DIFFICULTY_LABELS: Record<string, string> = { e: "Easy", m: "Moderate", h: "Hard", x: "Expert" };
export const SELECTED_COLOR = "#ffc21a";
export const THRU_HIKE_COLOR = "#d97706";
const FONT = ["Noto Sans Bold"];

/** Piste colours according to standard ski difficulty conventions */
export const PISTE_COLORS: Record<string, string> = {
  novice: "#22c55e",       // Green circle
  easy: "#3b82f6",         // Blue square
  intermediate: "#ef4444", // Red square
  advanced: "#0f172a",     // Black diamond
  expert: "#581c87",       // Double black
  freeride: "#ea580c",     // Orange backcountry/freeride
  nordic: "#06b6d4",       // Cyan nordic track
};

/** Hike-feature colours by group (src/lib/routing/features.ts), shared with the route builder's list. */
export const FEATURE_GROUP_COLORS: Record<string, string> = { water: "#0284c7", camping: "#d97706", other: "#475569" };
export const MY_TRAIL_COLOR = "#8b5cf6";

const difficultyColor: maplibreTypes.ExpressionSpecification = [
  "match", ["get", "d"],
  "e", DIFFICULTY_COLORS.e,
  "h", DIFFICULTY_COLORS.h,
  "x", DIFFICULTY_COLORS.x,
  DIFFICULTY_COLORS.m,
];

const pisteDifficultyColor: maplibreTypes.ExpressionSpecification = [
  "match", ["get", "pisteDifficulty"],
  "novice", PISTE_COLORS.novice,
  "easy", PISTE_COLORS.easy,
  "intermediate", PISTE_COLORS.intermediate,
  "advanced", PISTE_COLORS.advanced,
  "expert", PISTE_COLORS.expert,
  "freeride", PISTE_COLORS.freeride,
  PISTE_COLORS.easy,
];


let dem: InstanceType<typeof mlcontour.DemSource> | null = null;
/** One shared DEM source; contour tiles are generated in its worker, so panning stays smooth. */
function contours() {
  if (!dem) {
    dem = new mlcontour.DemSource({ url: TERRARIUM, encoding: "terrarium", maxzoom: 13, worker: true, cacheSize: 100 });
    dem.setupMaplibre(maplibregl as never);
  }
  return dem;
}

const vectorStyles = new Map<string, Promise<maplibreTypes.StyleSpecification>>();
/** An OpenFreeMap vector style (liberty, bright, positron, dark), fetched once. */
function openFreeMap(name: string) {
  let hit = vectorStyles.get(name);
  if (!hit) {
    hit = fetch(`${OPENFREEMAP}/${name}`).then((r) => {
      if (!r.ok) throw new Error(`Basemap style ${r.status}`);
      return r.json() as Promise<maplibreTypes.StyleSpecification>;
    }).catch((error) => { vectorStyles.delete(name); throw error; });
    vectorStyles.set(name, hit);
  }
  return hit;
}

const hillshadeLayer = (exaggeration = 0.35, dark = false): maplibreTypes.LayerSpecification => ({
  id: "hillshade", type: "hillshade", source: "terrain",
  paint: dark
    ? { "hillshade-exaggeration": exaggeration, "hillshade-shadow-color": "#000000", "hillshade-highlight-color": "#3a4a3a", "hillshade-accent-color": "#111a11" }
    : { "hillshade-exaggeration": exaggeration, "hillshade-shadow-color": "#4b5a49", "hillshade-highlight-color": "#ffffff", "hillshade-accent-color": "#6b7b67" },
});

/** Contour lines (feet) with labels on index lines, coloured for a light or an imagery background. */
function contourLayers(onImagery = false): maplibreTypes.LayerSpecification[] {
  return [
    { id: "contours", type: "line", source: "contours", "source-layer": "contours", minzoom: 10,
      paint: { "line-color": onImagery ? "#f7e7c6" : "#8a6b4a", "line-opacity": ["case", [">", ["get", "level"], 0], onImagery ? 0.7 : 0.55, onImagery ? 0.4 : 0.28], "line-width": ["case", [">", ["get", "level"], 0], 1, 0.5] } },
    { id: "contour-labels", type: "symbol", source: "contours", "source-layer": "contours", minzoom: 12, filter: [">", ["get", "level"], 0],
      layout: { "symbol-placement": "line", "text-field": ["concat", ["number-format", ["get", "ele"], {}], " ft"], "text-font": ["Noto Sans Regular"], "text-size": 10 },
      paint: onImagery ? { "text-color": "#fff8e8", "text-halo-color": "#3b2f1f", "text-halo-width": 1.2 } : { "text-color": "#7a5c3c", "text-halo-color": "#fbf8f1", "text-halo-width": 1.2 } },
  ];
}

/** The DEM sources every style carries: terrain (hillshading and 3D) and generated contour tiles. */
function demSources(): Record<string, maplibreTypes.SourceSpecification> {
  return {
    terrain: TERRAIN_SOURCE,
    contours: {
      type: "vector",
      tiles: [contours().contourProtocolUrl({ multiplier: 3.28084, thresholds: { 10: [200, 1000], 12: [100, 500], 13: [50, 250], 15: [20, 100] }, elevationKey: "ele", levelKey: "level", contourLayer: "contours" })],
      maxzoom: 15,
    },
  };
}

/** Hillshading under the roads and water, contours (feet) with labels on index lines. */
function withTerrain(style: maplibreTypes.StyleSpecification, exaggeration = 0.35, dark = false): maplibreTypes.StyleSpecification {
  const layers = [...style.layers];
  const at = (re: RegExp) => { const i = layers.findIndex((l) => re.test(l.id)); return i < 0 ? layers.length : i; };
  layers.splice(at(/^water/), 0, hillshadeLayer(exaggeration, dark));
  if (!dark) layers.splice(at(/^(tunnel|road|bridge|building)/), 0, ...contourLayers());
  return { ...style, sources: { ...style.sources, ...demSources() }, layers };
}

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const USGS = "https://basemap.nationalmap.gov/arcgis/rest/services";
const esri = (service: string) => `${ESRI}/${service}/MapServer/tile/{z}/{y}/{x}`;
const ESRI_CREDIT = "Basemap © Esri and its data providers";

/** A raster basemap: base tiles, optional hillshading and contours from the DEM, optional label tiles on top. */
function rasterStyle(base: { tiles: string; maxzoom: number; attribution: string }, opts: { hillshade?: number; contours?: boolean; onImagery?: boolean; labels?: string[] } = {}): maplibreTypes.StyleSpecification {
  const sources: Record<string, maplibreTypes.SourceSpecification> = {
    ...demSources(),
    base: { type: "raster", tiles: [base.tiles], tileSize: 256, maxzoom: base.maxzoom, attribution: base.attribution },
  };
  const layers: maplibreTypes.LayerSpecification[] = [{ id: "base", type: "raster", source: "base" }];
  if (opts.hillshade) layers.push(hillshadeLayer(opts.hillshade));
  if (opts.contours) layers.push(...contourLayers(opts.onImagery));
  (opts.labels ?? []).forEach((url, i) => {
    sources[`labels-${i}`] = { type: "raster", tiles: [url], tileSize: 256, maxzoom: 19 };
    layers.push({ id: `labels-${i}`, type: "raster", source: `labels-${i}` });
  });
  return { version: 8, glyphs: GLYPHS, sources, layers };
}

function satellite(withContours = false): maplibreTypes.StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      ...demSources(),
      satellite: { type: "raster", tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19, attribution: "Imagery © Esri, Maxar, Earthstar Geographics" },
      roads: { type: "raster", tiles: [`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19 },
      labels: { type: "raster", tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19 },
    },
    layers: [
      { id: "satellite", type: "raster", source: "satellite" },
      ...(withContours ? contourLayers(true) : []),
      { id: "roads", type: "raster", source: "roads" },
      { id: "labels", type: "raster", source: "labels" },
    ],
  };
}

export async function explorerStyle(basemap: Basemap): Promise<maplibreTypes.StyleSpecification> {
  switch (basemap) {
    case "satellite": return satellite();
    case "hybrid": return satellite(true);
    case "outdoors": return rasterStyle({ tiles: esri("World_Topo_Map"), maxzoom: 19, attribution: ESRI_CREDIT });
    case "terrain": return rasterStyle({ tiles: esri("World_Terrain_Base"), maxzoom: 13, attribution: ESRI_CREDIT }, { hillshade: 0.45, contours: true, labels: [esri("Reference/World_Reference_Overlay")] });
    case "relief": return rasterStyle({ tiles: esri("World_Shaded_Relief"), maxzoom: 13, attribution: ESRI_CREDIT }, { hillshade: 0.3, labels: [esri("Reference/World_Boundaries_and_Places")] });
    case "natgeo": return rasterStyle({ tiles: esri("NatGeo_World_Map"), maxzoom: 16, attribution: `${ESRI_CREDIT}, National Geographic` });
    case "usgs": return rasterStyle({ tiles: `${USGS}/USGSTopo/MapServer/tile/{z}/{y}/{x}`, maxzoom: 16, attribution: "USGS The National Map" });
    case "usgs-imagery": return rasterStyle({ tiles: `${USGS}/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}`, maxzoom: 16, attribution: "USGS The National Map" });
  }
  try {
    const name = { topo: "liberty", standard: "liberty", bright: "bright", light: "positron", dark: "dark" }[basemap];
    const style = await openFreeMap(name);
    if (basemap === "topo") return withTerrain(style);
    if (basemap === "dark") return withTerrain(style, 0.25, true);
    return { ...style, sources: { ...style.sources, ...demSources() } };
  } catch {
    // The vector basemap is unreachable: imagery still gives a usable map with Hyked trails on top.
    return satellite();
  }
}

export const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export interface OverlayData {
  pins: GeoJSON.FeatureCollection;
  grid: GeoJSON.FeatureCollection;
  lines: GeoJSON.FeatureCollection;
  selected: GeoJSON.FeatureCollection;
  drive: GeoJSON.FeatureCollection;
  route: GeoJSON.FeatureCollection;
  thruHikes?: GeoJSON.FeatureCollection;
  pistes?: GeoJSON.FeatureCollection;
  lifts?: GeoJSON.FeatureCollection;
  pois?: GeoJSON.FeatureCollection;
  myTrails?: GeoJSON.FeatureCollection;
}

/** Hyked's own sources and layers; re-installed after every basemap switch. */
export function installOverlay(map: maplibreTypes.Map, data: OverlayData) {
  if (map.getSource("hy-pins")) return;

  // 1. Long-Distance Through-Hike Corridors Layer
  map.addSource("hy-thru-hikes", { type: "geojson", data: data.thruHikes ?? EMPTY });
  map.addLayer({
    id: "hy-thru-hikes-casing",
    type: "line",
    source: "hy-thru-hikes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#451a03", "line-width": ["interpolate", ["linear"], ["zoom"], 4, 3, 10, 6, 14, 10], "line-opacity": 0.8 },
  });
  map.addLayer({
    id: "hy-thru-hikes",
    type: "line",
    source: "hy-thru-hikes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": THRU_HIKE_COLOR, "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.8, 10, 4, 14, 6] },
  });
  map.addLayer({
    id: "hy-thru-hikes-label",
    type: "symbol",
    source: "hy-thru-hikes",
    minzoom: 8,
    layout: { "symbol-placement": "line", "text-field": ["get", "name"], "text-font": FONT, "text-size": 13, "symbol-spacing": 400 },
    paint: { "text-color": "#451a03", "text-halo-color": "#fef3c7", "text-halo-width": 2 },
  });

  // 2. Ski Pistes & Aerial Lifts
  map.addSource("hy-ski-pistes", { type: "geojson", data: data.pistes ?? EMPTY });
  map.addLayer({
    id: "hy-ski-pistes",
    type: "line",
    source: "hy-ski-pistes",
    minzoom: 11,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": pisteDifficultyColor,
      "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2, 14, 4.5, 17, 7],
      "line-opacity": 0.9,
    },
  });
  map.addSource("hy-ski-lifts", { type: "geojson", data: data.lifts ?? EMPTY });
  map.addLayer({
    id: "hy-ski-lifts",
    type: "line",
    source: "hy-ski-lifts",
    minzoom: 12,
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: { "line-color": "#475569", "line-width": 2, "line-dasharray": [3, 2] },
  });

  // 3. Local Trails & Singletracks
  map.addSource("hy-lines", { type: "geojson", data: data.lines });
  map.addSource("hy-route", { type: "geojson", data: data.route });
  const routeColor = getComputedStyle(map.getContainer()).getPropertyValue("--accent").trim() || SELECTED_COLOR;
  map.addLayer({ id: "hy-route-casing", type: "line", source: "hy-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#1a1405", "line-width": 10, "line-opacity": 0.6 } });
  map.addLayer({ id: "hy-route", type: "line", source: "hy-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": routeColor, "line-width": 6 } });
  map.addSource("hy-drive", { type: "geojson", data: data.drive });
  map.addSource("hy-selected", { type: "geojson", data: data.selected });
  map.addSource("hy-grid", { type: "geojson", data: data.grid });
  map.addSource("hy-pins", { type: "geojson", data: data.pins, cluster: true, clusterRadius: 46, clusterMaxZoom: 10 });

  map.addLayer({ id: "hy-drive-casing", type: "line", source: "hy-drive", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#0b2a4a", "line-width": 8, "line-opacity": 0.5 } });
  map.addLayer({ id: "hy-drive", type: "line", source: "hy-drive", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#3a8dff", "line-width": 4.5 } });

  map.addLayer({ id: "hy-lines-casing", type: "line", source: "hy-lines", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#14110f", "line-opacity": 0.55, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 3, 13, 6, 17, 10] } });
  map.addLayer({
    id: "hy-lines", type: "line", source: "hy-lines", minzoom: TRAIL_DETAIL_ZOOM, layout: { "line-cap": "round", "line-join": "round" },
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

  // 4. Clusters & Pins
  for (const source of ["hy-grid", "hy-pins"] as const) {
    const filter: maplibreTypes.FilterSpecification = source === "hy-pins" ? ["has", "point_count"] : ["has", "count"];
    const count: maplibreTypes.ExpressionSpecification = source === "hy-pins" ? ["get", "point_count"] : ["get", "count"];
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
    id: "hy-pin", type: "circle", source: "hy-pins", minzoom: TRAIL_DETAIL_ZOOM, filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": difficultyColor,
      // Small start markers: the lines carry the map once they are drawn.
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 4.5, 13, 3.5, 16, 4.5],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
      "circle-opacity": ["interpolate", ["linear"], ["zoom"], 12, 1, 14, 0.75],
    },
  });
  map.addLayer({
    id: "hy-pin-selected", type: "circle", source: "hy-pins", filter: ["==", ["get", "id"], ""],
    paint: { "circle-color": SELECTED_COLOR, "circle-radius": 10, "circle-stroke-color": "#1a1405", "circle-stroke-width": 3 },
  });

  // 5. Hike features (water, camping, other) from the pipeline's feature layer; one layer per group so each toggles.
  map.addSource("hy-pois", { type: "geojson", data: data.pois ?? EMPTY });
  for (const group of ["other", "camping", "water"] as const) {
    map.addLayer({
      id: `hy-feat-${group}`, type: "circle", source: "hy-pois", minzoom: group === "other" ? 13.5 : 12, filter: ["==", ["get", "group"], group],
      paint: {
        "circle-color": FEATURE_GROUP_COLORS[group],
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, group === "other" ? 3 : 4, 15, group === "other" ? 5.5 : 7],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
      },
    });
  }
  map.addLayer({
    id: "hy-feat-label", type: "symbol", source: "hy-pois", minzoom: 13.5, filter: ["!=", ["get", "name"], ""],
    layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true },
    paint: { "text-color": "#0f172a", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
  });

  // 6. The visitor's own saved trails; the route being built stays on top.
  map.addSource("hy-mytrails", { type: "geojson", data: data.myTrails ?? EMPTY });
  map.addLayer({ id: "hy-mytrails-casing", type: "line", source: "hy-mytrails", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 4, 14, 8] } });
  map.addLayer({ id: "hy-mytrails", type: "line", source: "hy-mytrails", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": MY_TRAIL_COLOR, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 2.5, 14, 5] } });
  map.moveLayer("hy-route-casing");
  map.moveLayer("hy-route");
}

/** Feature names are labelled only for the groups that are switched on. */
export function setFeatureLabelGroups(map: maplibreTypes.Map, groups: string[]) {
  if (map.getLayer("hy-feat-label")) map.setFilter("hy-feat-label", ["all", ["!=", ["get", "name"], ""], ["in", ["get", "group"], ["literal", groups]]]);
}

/** Toggles visibility for specific layer categories */
export function setLayerGroupVisibility(
  map: maplibreTypes.Map,
  group: "thru-hikes" | "day-trails" | "ski" | "water" | "camping" | "other" | "my-trails",
  visible: boolean,
) {
  const layerMap: Record<string, string[]> = {
    "thru-hikes": ["hy-thru-hikes-casing", "hy-thru-hikes", "hy-thru-hikes-label"],
    "day-trails": ["hy-lines-casing", "hy-lines", "hy-lines-label", "hy-pin"],
    ski: ["hy-ski-pistes", "hy-ski-lifts"],
    water: ["hy-feat-water"],
    camping: ["hy-feat-camping"],
    other: ["hy-feat-other"],
    "my-trails": ["hy-mytrails-casing", "hy-mytrails"],
  };

  const layers = layerMap[group] ?? [];
  const val = visible ? "visible" : "none";
  for (const layerId of layers) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", val);
    }
  }
}

export function setSky(map: maplibreTypes.Map, on: boolean) {
  try {
    map.setSky(on ? { "sky-color": "#a9cbe8", "horizon-color": "#eef1ea", "fog-color": "#eef1ea", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.7, "fog-ground-blend": 0.25, "atmosphere-blend": 0.6 } : {});
  } catch {
    /* sky is cosmetic */
  }
}
