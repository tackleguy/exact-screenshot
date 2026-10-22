/** Zoomed out, the map shows count bubbles; from this zoom it shows individual trails. */
export const TRAIL_DETAIL_ZOOM = 11;
/** Trails drawn on the map at once (pins and lines, clustered in MapLibre's worker). */
export const MAP_TRAIL_LIMIT = 250;
/** Cards in the list, best-documented first; the heading always states the full count. */
export const TRAIL_CARD_LIMIT = 12;
export function localTrailsVisible(zoom: number) {
  return Number.isFinite(zoom) && zoom >= TRAIL_DETAIL_ZOOM;
}
export function readableTrailName(name: string, id: string) {
  const clean = name.trim();
  return !clean || /^(unnamed( trail)?|unknown|n\/a|<unnamed>|-)$/i.test(clean)
    ? `Unnamed trail · ${id.replace(/[^a-z0-9]/gi, "").slice(-6)}`
    : clean;
}