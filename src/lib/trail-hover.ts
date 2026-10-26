/**
 * Links a trail page's elevation chart and its map: hovering the chart at mile X moves a dot on the map to the
 * same place, and hovering the trail on the map moves the chart's cursor. Each side ignores its own messages.
 */
const EVENT = "hyked:trail-hover";

export interface TrailHover { trailId: string; mile: number | null; from: "chart" | "map" }

export function emitTrailHover(detail: TrailHover) {
  window.dispatchEvent(new CustomEvent<TrailHover>(EVENT, { detail }));
}

export function onTrailHover(listener: (detail: TrailHover) => void) {
  const handler = (e: Event) => listener((e as CustomEvent<TrailHover>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
