import type { StyleSpecification } from "maplibre-gl";
import type { MapMode } from "@/lib/types";

/**
 * OpenTrailMap styles are self-hosted under /public/opentrailmap because
 * opentrailmap.us no longer serves /dist/styles/*.json (404 after Vite redeploy).
 * Override with NEXT_PUBLIC_OPENTRAILMAP_URL only when serving styles elsewhere.
 * The legacy default host is ignored so existing Vercel env vars keep working.
 */
function resolveOpenTrailMapOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_OPENTRAILMAP_URL?.replace(/\/$/, "") ?? "";
  if (!raw) return "";
  if (
    raw === "https://opentrailmap.us" ||
    raw === "http://opentrailmap.us"
  ) {
    return "";
  }
  return raw;
}

export const OPENTRAILMAP_ORIGIN = resolveOpenTrailMapOrigin();

export const OPENTRAILMAP_SPRITE = `${OPENTRAILMAP_ORIGIN}/opentrailmap/sprites/opentrailmap`;

/** Fallback basemap when OpenTrailMap styles fail to load */
export const OPENFREEMAP_FALLBACK_STYLE =
  "https://tiles.openfreemap.org/styles/liberty";

/** Static style filenames from vendor/opentrailmap scripts/buildStaticStyles.js */
export const OPENTRAILMAP_STYLE_BY_MODE: Record<MapMode, string> = {
  trail: `${OPENTRAILMAP_ORIGIN}/opentrailmap/styles/otm-foot.json`,
  ski: `${OPENTRAILMAP_ORIGIN}/opentrailmap/styles/otm-ski_nordic.json`,
};

export interface OpenTrailFeatureSummary {
  osmId: string;
  osmType: string;
  name: string;
  lat: number;
  lng: number;
  highway?: string;
  operator?: string;
  network?: string;
}

/** Layers with invisible hit targets for trail / POI clicks */
export const OPENTRAILMAP_CLICKABLE_LAYERS = [
  "trails-pointer-targets",
  "trail-pois",
  "major-trail-pois",
  "trail-centerpoints",
  "peaks",
] as const;

const styleCache = new Map<string, StyleSpecification>();

/**
 * OSM US trails tileset currently exposes only trail + trail_poi
 * (see https://tiles.openstreetmap.us/vector/trails.json and osmus/tileservice
 * renderer/layers/trails.yml). Older OpenTrailMap styles still reference park /
 * barrier layers, and MapLibre stops rendering on the missing source-layers.
 */
export const OSM_US_TRAILS_SOURCE_LAYERS = new Set(["trail", "trail_poi"]);

export function sanitizeOpenTrailMapStyle(
  style: StyleSpecification,
): StyleSpecification {
  if (!Array.isArray(style.layers)) return style;

  return {
    ...style,
    layers: style.layers.filter((layer) => {
      if (!("source" in layer) || layer.source !== "trails") return true;
      const sourceLayer =
        "source-layer" in layer ? layer["source-layer"] : undefined;
      if (typeof sourceLayer !== "string") return true;
      return OSM_US_TRAILS_SOURCE_LAYERS.has(sourceLayer);
    }),
  };
}

export async function loadOpenTrailMapStyle(
  mode: MapMode,
): Promise<StyleSpecification> {
  const url = OPENTRAILMAP_STYLE_BY_MODE[mode];
  const cached = styleCache.get(url);
  if (cached) return cached;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`OpenTrailMap style failed (${res.status}): ${url}`);
  }

  const style = sanitizeOpenTrailMapStyle(
    (await res.json()) as StyleSpecification,
  );
  // Absolute path so MapLibre resolves sprites against the app origin
  // MapLibre 6 rejects relative sprite URLs, so resolve against the page origin.
  style.sprite = new URL(OPENTRAILMAP_SPRITE || "/opentrailmap/sprites/opentrailmap", window.location.origin).href;

  styleCache.set(url, style);
  return style;
}

/** Prefer OpenTrailMap; fall back to OpenFreeMap so the map still renders. */
export async function loadMapStyle(
  mode: MapMode,
): Promise<{ style: StyleSpecification | string; source: "opentrailmap" | "openfreemap" }> {
  try {
    const style = await loadOpenTrailMapStyle(mode);
    return { style, source: "opentrailmap" };
  } catch {
    return { style: OPENFREEMAP_FALLBACK_STYLE, source: "openfreemap" };
  }
}

export function isOpenTrailMapClickableLayer(layerId: string): boolean {
  return OPENTRAILMAP_CLICKABLE_LAYERS.some((id) => layerId === id);
}

export function openTrailFeatureFromProperties(
  props: Record<string, unknown> | null | undefined,
  lat: number,
  lng: number,
): OpenTrailFeatureSummary | null {
  if (!props) return null;

  const osmId = props.OSM_ID != null ? String(props.OSM_ID) : "";
  const osmType = props.OSM_TYPE != null ? String(props.OSM_TYPE) : "";

  if (!osmId || !osmType) return null;

  const name =
    (props.name != null && String(props.name)) ||
    (props.ref != null && String(props.ref)) ||
    (props.highway != null && `${String(props.highway)} trail`) ||
    "Unnamed trail";

  return {
    osmId,
    osmType,
    name,
    lat,
    lng,
    highway: props.highway != null ? String(props.highway) : undefined,
    operator: props.operator != null ? String(props.operator) : undefined,
    network: props.network != null ? String(props.network) : undefined,
  };
}

export function openTrailMapOsmUrl(feature: OpenTrailFeatureSummary): string {
  return `https://www.openstreetmap.org/${feature.osmType}/${feature.osmId}`;
}
