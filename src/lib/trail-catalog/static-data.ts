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

/** Bounds [west, south, east, north] of a 2° pin cell key. */
export function cellBounds(key: string): [number, number, number, number] {
  const [x, y] = key.split("_").map(Number);
  return [x * 2 - 180, y * 2 - 90, x * 2 - 178, y * 2 - 88];
}

/** Every trail's full record, in 16,384 files by id: `rows/r-<hhhh>.json.gz` ({ id: trail | "r:<id it merged into>" }). */
export const ROW_SHARDS = 16384;
export function rowShard(id: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return (h % ROW_SHARDS).toString(16).padStart(4, "0");
}

/**
 * Search files: `q/<key>.json.gz` holds every trail with a name, other-name or park/forest word starting with the
 * key (the word's first three letters). Words this common in trail names are not keys; a trail named only with
 * them is filed under them anyway.
 */
export const SEARCH_STOPWORDS = new Set(
  "national forest park state county recreation area regional provincial reserve trail trails route chemin bike footpath road des camino loop track del weg via street unnamed avenue path sentier sentiero wanderweg rundweg rundwanderweg les the and walk spur lane way circuit von der die das und sur aux con per los las".split(" "),
);
export const searchKey = (word: string) => word.slice(0, 3);
/** Region and country files: the best-documented trails of a region (`q/r-<region>.json.gz`) or country (`q/c-<CC>.json.gz`). */
export const regionSlug = (normalizedRegion: string) => normalizedRegion.replace(/ /g, "-");
