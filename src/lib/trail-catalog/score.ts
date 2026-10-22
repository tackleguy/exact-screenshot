import type { CatalogTrail } from "./types";

/**
 * Quality score used to rank search, map lists and "near you" suggestions. Points add up from evidence that
 * the record is a whole, real, well-documented trail:
 *
 * | signal                                           | points |
 * |--------------------------------------------------|--------|
 * | verified tier (official record or route relation)| +15    |
 * | OpenStreetMap route relation (or merged with one)| +25    |
 * | official agency source (NPS, USFS, BLM, Parks Canada, state) | +20 |
 * | matched Wikidata item / Wikipedia article        | +15 / +10 more |
 * | mapped trailhead or parking                      | +8     |
 * | has a real name                                  | +10    |
 * | longer than 1 mile                               | +8     |
 * | national or international network (nwn/iwn/ncn/icn) | +15 |
 * | regional network (rwn/rcn)                       | +8     |
 * | local network (lwn/lcn)                          | +3     |
 * | inside a national park, state park or forest     | +10    |
 * | mapped tier that barely passed (under 0.5 mi, one way, no other source) | −10 |
 * | climbers' approach / descent path                | −25    |
 * | unnamed, fragment or connector piece             | −30    |
 * | shorter than 0.25 mile                           | −10    |
 */
export const SCORE_DOC = "Verified tier +15, OSM relation +25, official source +20, Wikidata +15 (+10 with a Wikipedia article), trailhead +8, named +10, over 1 mi +8, national network +15, regional +8, local +3, inside a park or forest +10; climbers' approach/descent −25, unnamed or fragment −30, under 0.25 mi −10, mapped trail that barely passed the filter −10.";

const CLIMBER = /\b(climbers?'?|climbing)\s+(trail|path|access|approach)|\b(approach|descent)\b/i;
const OFFICIAL = new Set(["NPS_OFFICIAL", "USFS_OFFICIAL", "BLM_OFFICIAL", "PARKS_CANADA_OFFICIAL", "STATE_AGENCY", "LOCAL_AGENCY"]);

export function qualityScore(t: CatalogTrail): number {
  let score = 0;
  if (t.tier === "verified") score += 15;
  if (t.osm) score += 25;
  if ((t.sourceType && OFFICIAL.has(t.sourceType)) || t.sources?.some((s) => OFFICIAL.has(s.type)) || ["nps", "usfs", "blm", "parks-canada"].includes(t.source)) score += 20;
  if (t.wiki) score += 15 + (t.wiki.title ? 10 : 0);
  if (t.trailhead && t.trailhead.kind !== "trail-end") score += 8;
  const unnamed = /^unnamed/i.test(t.name) || Boolean(t.originalName);
  if (!unnamed) score += 10;
  if ((t.miles ?? 0) > 1) score += 8;
  const network = t.osm?.network ?? "";
  if (/^(nwn|iwn|ncn|icn|nhn|nmn)$/.test(network)) score += 15;
  else if (/^(rwn|rcn|rhn|rmn)$/.test(network)) score += 8;
  else if (/^(lwn|lcn|lhn|lmn)$/.test(network)) score += 3;
  if (t.park || t.forest || /\b(state|provincial|national|regional|county) (park|forest|recreation area)\b/i.test(t.manager ?? "")) score += 10;
  if (t.tier === "mapped" && (t.miles ?? 0) < 0.5 && (t.osmWay?.ids.length ?? 1) <= 1 && !t.sources?.length) score -= 10;
  if (CLIMBER.test(t.name)) score -= 25;
  if (unnamed || t.quality === "fragment") score -= 30;
  if (t.miles !== null && t.miles < 0.25) score -= 10;
  return score;
}
