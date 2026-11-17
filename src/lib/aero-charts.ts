import type * as maplibreTypes from "maplibre-gl";

const FAA_TILES = "https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services";
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

export const FAA_CHARTS = {
  vfrSectional: `${FAA_TILES}/VFR_Sectional/MapServer/tile/{z}/{y}/{x}`,
  vfrTerminal: `${FAA_TILES}/VFR_Terminal/MapServer/tile/{z}/{y}/{x}`,
  ifrLow: `${FAA_TILES}/IFR_AreaLow/MapServer/tile/{z}/{y}/{x}`,
  ifrHigh: `${FAA_TILES}/IFR_High/MapServer/tile/{z}/{y}/{x}`,
} as const;

export const FAA_CREDIT =
  'Charts: <a href="https://www.faa.gov/air_traffic/flight_info/aeronav/">FAA Aeronautical Information Services</a> (reference only, not for navigation)';

export const AERO_LAYER_IDS = [
  "aero-vfr-sectional",
  "aero-vfr-terminal",
  "aero-ifr-high",
  "aero-ifr-low",
  "hy-vfr-sectional",
  "hy-vfr-terminal",
  "hy-ifr-high",
  "hy-ifr-low",
] as const;

/**
 * Builds a MapLibre v8 style specification for 3D FAA VFR (Sectional + Terminal Area)
 * or 3D FAA IFR (Enroute High + Low) aeronautical charts draped over DEM sources.
 */
export function buildAeronauticalStyle(
  mode: "vfr" | "ifr",
  dem: Record<string, maplibreTypes.SourceSpecification>,
  extraLayers: { hillshade: maplibreTypes.LayerSpecification; contours?: maplibreTypes.LayerSpecification[] },
  opacity = 0.88,
): maplibreTypes.StyleSpecification {
  const clampedOpacity = Math.min(1, Math.max(0.35, opacity));
  const esriAttribution = `Basemap © Esri and its data providers · ${FAA_CREDIT}`;

  if (mode === "vfr") {
    return {
      version: 8,
      glyphs: GLYPHS,
      sources: {
        ...dem,
        base: {
          type: "raster",
          tiles: [`${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`],
          tileSize: 256,
          maxzoom: 19,
          attribution: esriAttribution,
        },
        "aero-vfr-sectional": {
          type: "raster",
          tiles: [FAA_CHARTS.vfrSectional],
          tileSize: 256,
          minzoom: 8,
          maxzoom: 12,
        },
        "aero-vfr-terminal": {
          type: "raster",
          tiles: [FAA_CHARTS.vfrTerminal],
          tileSize: 256,
          minzoom: 10,
          maxzoom: 12,
        },
      },
      layers: [
        { id: "base", type: "raster", source: "base" },
        extraLayers.hillshade,
        {
          id: "aero-vfr-sectional",
          type: "raster",
          source: "aero-vfr-sectional",
          minzoom: 8,
          paint: { "raster-opacity": clampedOpacity },
        },
        {
          id: "aero-vfr-terminal",
          type: "raster",
          source: "aero-vfr-terminal",
          minzoom: 10,
          paint: { "raster-opacity": clampedOpacity },
        },
      ],
    };
  }

  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      ...dem,
      base: {
        type: "raster",
        tiles: [`${ESRI}/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}`],
        tileSize: 256,
        maxzoom: 13,
        attribution: esriAttribution,
      },
      "base-labels": {
        type: "raster",
        tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`],
        tileSize: 256,
        maxzoom: 19,
      },
      "aero-ifr-high": {
        type: "raster",
        tiles: [FAA_CHARTS.ifrHigh],
        tileSize: 256,
        minzoom: 5,
        maxzoom: 9,
      },
      "aero-ifr-low": {
        type: "raster",
        tiles: [FAA_CHARTS.ifrLow],
        tileSize: 256,
        minzoom: 7,
        maxzoom: 12,
      },
    },
    layers: [
      { id: "base", type: "raster", source: "base" },
      extraLayers.hillshade,
      ...(extraLayers.contours ?? []),
      { id: "base-labels", type: "raster", source: "base-labels", maxzoom: 7 },
      {
        id: "aero-ifr-high",
        type: "raster",
        source: "aero-ifr-high",
        minzoom: 5,
        maxzoom: 8,
        paint: { "raster-opacity": clampedOpacity },
      },
      {
        id: "aero-ifr-low",
        type: "raster",
        source: "aero-ifr-low",
        minzoom: 7,
        paint: { "raster-opacity": clampedOpacity },
      },
    ],
  };
}
