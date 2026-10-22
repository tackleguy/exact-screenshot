/**
 * File layout of the static trail data (scripts/prepare-trail-assets.ts writes it, src/web/trail-service.ts reads
 * it). U.S. and Canada trails sit in `cell-<x>_<y>.json.gz` by the 2° cell of their pin; worldwide trails are split
 * further by country, `cell-<x>_<y>-<country>.json.gz`, so the build never holds every country at once. A "cell
 * ref" names one such file: `x_y` or `x_y~CC`.
 */

/** 2° cell of a trail's map pin. */
export const pinCell = (longitude: number, latitude: number) => `${Math.floor((longitude + 180) / 2)}_${Math.floor((latitude + 90) / 2)}`;

export const cellRef = (key: string, country?: string) => (country ? `${key}~${country}` : key);
export const cellKeyOf = (ref: string) => ref.split("~")[0];
export const cellFile = (ref: string) => {
  const [key, country] = ref.split("~");
  return country ? `cell-${key}-${country}.json.gz` : `cell-${key}.json.gz`;
};

/** Trail id → where it lives, in 256 files: `lookup/l-<hh>.json.gz` ({ id: "c:<cell ref>" | "r:<id it merged into>" }). */
export const LOOKUP_SHARDS = 256;
export function lookupShard(id: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return (h % LOOKUP_SHARDS).toString(16).padStart(2, "0");
}

/** Bounds [west, south, east, north] of a 2° pin cell key. */
export function cellBounds(key: string): [number, number, number, number] {
  const [x, y] = key.split("_").map(Number);
  return [x * 2 - 180, y * 2 - 90, x * 2 - 178, y * 2 - 88];
}
