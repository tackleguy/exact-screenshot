import type { CatalogTrail } from "./types";

/** Winter-only / motorized names that often appear in the hiking-oriented catalog. */
const WINTER_ACTIVITY =
  /\b(ski(ing)?|skier|nordic|cross[\s-]?country|\bx-?c\b|snowshoe(ing)?|snow[\s-]?mobile|snowmobile|snowmobiling|groomed\s+ski|ski\s+trail|ski\s+loop)\b/i;

const PLACE_FALSE_POSITIVE =
  /\b(snow\s+(canyon|creek|lake|peak|mountain|river|pass|basin|valley)|muskie|skinner|skiing\s+eagle)\b/i;

/**
 * True when a catalog section is primarily a winter or snowmobile route
 * rather than a hiking trail: its line follows a downhill piste, or its name/manager says so.
 */
export function isWinterActivityTrail(trail: Pick<CatalogTrail, "name" | "manager"> & Partial<Pick<CatalogTrail, "winterUse" | "source">>): boolean {
  // Summer trails a resort lists; the resort's name ("Taos Ski Valley") says nothing about the trail.
  if (trail.source === "resort") return false;
  // Mapped on a downhill piste: a ski run whatever its name says.
  if (trail.winterUse === "downhill" || trail.winterUse === "oversnow") return true;
  const haystack = `${trail.name} ${trail.manager ?? ""}`;
  if (PLACE_FALSE_POSITIVE.test(haystack)) return false;
  return WINTER_ACTIVITY.test(haystack);
}
