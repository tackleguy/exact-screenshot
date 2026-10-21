import type * as maplibregl from "maplibre-gl";
import { TRAIL_DETAIL_ZOOM } from "@/lib/trail-catalog/discovery";
import { skiLineColor } from "@/components/ski/SkiAreaMap";
import { sectionExpression } from "@/lib/osm-trail";
import type { TrailSectionKey } from "@/lib/trail-catalog/activity";

/** Ski pins/lines and the invisible tap layer over base-map trails; re-installed after style swaps. */
export function installExtras(map: maplibregl.Map, data: { skiPins: GeoJSON.FeatureCollection; skiLines: GeoJSON.FeatureCollection }) {
  if (map.getSource("hy-ski-pins")) return;
  const before = map.getLayer("hy-lines-casing") ? "hy-lines-casing" : undefined;
  if (map.getSource("trails")) {
    map.addLayer({ id: "hy-osm-hit", type: "line", source: "trails", "source-layer": "trail", minzoom: TRAIL_DETAIL_ZOOM, paint: { "line-width": 12, "line-opacity": 0 } }, before);
  }
  map.addSource("hy-ski-lines", { type: "geojson", data: data.skiLines });
  map.addLayer({ id: "hy-ski-lines", type: "line", source: "hy-ski-lines", layout: { "line-cap": "round" }, paint: { "line-color": skiLineColor, "line-width": 3 } }, before);
  map.addLayer({ id: "hy-ski-hit", type: "line", source: "hy-ski-lines", paint: { "line-width": 12, "line-opacity": 0 } }, before);
  map.addSource("hy-ski-pins", { type: "geojson", data: data.skiPins });
  map.addLayer({ id: "hy-ski-pin", type: "circle", source: "hy-ski-pins", paint: { "circle-color": "#ffffff", "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 2.5, 10, 6], "circle-stroke-width": 2, "circle-stroke-color": "#2f7fd8" } });
}

const original = new WeakMap<maplibregl.Map, Map<string, unknown>>();
/** Hide base-map trail lines outside the chosen section. */
export function applySectionFilter(map: maplibregl.Map, section: TrailSectionKey) {
  let saved = original.get(map);
  if (!saved) { saved = new Map(); original.set(map, saved); }
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type !== "line" || !("source" in layer) || layer.source !== "trails" || layer["source-layer"] !== "trail") continue;
    if (!saved.has(layer.id)) saved.set(layer.id, layer.filter ?? null);
    const base = saved.get(layer.id) as maplibregl.FilterSpecification | null;
    const expr = sectionExpression(section);
    try { map.setFilter(layer.id, (base ? ["all", base, expr] : expr) as maplibregl.FilterSpecification); } catch { /* legacy filter syntax */ }
  }
}
