/** Keep wide-area maps quiet; show a small local selection once the camera is close. */
export const TRAIL_DETAIL_ZOOM = 11;
export const MAP_TRAIL_LIMIT = 24;
export const TRAIL_CARD_LIMIT = 6;
export function localTrailsVisible(zoom: number) {
  return Number.isFinite(zoom) && zoom >= TRAIL_DETAIL_ZOOM;
}
export function readableTrailName(name: string, id: string) {
  const clean = name.trim();
  return !clean || /^(unnamed( trail)?|unknown|n\/a|<unnamed>|-)$/i.test(clean)
    ? `Unnamed trail · ${id.replace(/[^a-z0-9]/gi, "").slice(-6)}`
    : clean;
}