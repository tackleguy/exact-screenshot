import type { CatalogTrail } from "./types";
import { CATALOG_ACTIVITIES, trailActivities, type CatalogActivity } from "./activity";

export { TRAIL_SECTIONS, sectionOf, parseTrailSection, type TrailSectionKey } from "./activity";

/** Every section a trail appears in, in display order. */
export function trailSections(trail: CatalogTrail): CatalogActivity[] {
  const set = new Set(trailActivities(trail));
  return CATALOG_ACTIVITIES.filter((a) => set.has(a));
}
