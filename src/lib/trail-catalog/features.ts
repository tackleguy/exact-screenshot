/** Hike features (water, camping, access and landmarks) from the build-time feature layer. */
export const FEATURE_TYPES = [
  "spring", "drinking_water", "lake", "river", "crossing", "ford", "waterfall",
  "campsite", "camp_pitch", "shelter", "hut",
  "trailhead", "parking", "toilets", "ranger_station", "picnic_site",
  "viewpoint", "peak", "pass", "bridge",
] as const;
export type FeatureType = (typeof FEATURE_TYPES)[number];

export const FEATURE_GROUPS = {
  water: ["spring", "drinking_water", "lake", "river", "crossing", "ford"],
  camping: ["campsite", "camp_pitch", "shelter", "hut"],
  other: ["trailhead", "parking", "toilets", "ranger_station", "picnic_site", "viewpoint", "peak", "pass", "bridge", "waterfall"],
} as const satisfies Record<string, readonly FeatureType[]>;
export type FeatureGroup = keyof typeof FEATURE_GROUPS;

export const FEATURE_LABELS: Record<FeatureType, string> = {
  spring: "Spring", drinking_water: "Drinking water", lake: "Lake", river: "River", crossing: "Stream crossing", ford: "Ford",
  waterfall: "Waterfall", campsite: "Campsite", camp_pitch: "Camp pitch", shelter: "Shelter", hut: "Hut",
  trailhead: "Trailhead", parking: "Parking", toilets: "Toilets", ranger_station: "Ranger station", picnic_site: "Picnic site",
  viewpoint: "Viewpoint", peak: "Peak", pass: "Pass", bridge: "Bridge",
};

export const groupOf = (type: FeatureType): FeatureGroup =>
  (Object.keys(FEATURE_GROUPS) as FeatureGroup[]).find((g) => (FEATURE_GROUPS[g] as readonly string[]).includes(type)) ?? "other";

/** One shipped row: [id, type, name, lon, lat, extra | 0, [[trailId, mile, offTrailMeters], ...]]. */
export type FeatureRow = [string, FeatureType, string, number, number, Record<string, string | number | boolean> | 0, [string, number, number][]];

export interface HikeFeature {
  id: string;
  type: FeatureType;
  name: string;
  lat: number;
  lon: number;
  source: string;
  extra: Record<string, string | number | boolean>;
}

export interface TrailFeature extends HikeFeature {
  /** Mile along the trail (measured the way the trail page measures). */
  mile: number;
  offTrailFt: number;
}

export const FEATURE_SOURCE = "OpenStreetMap";

export function featureFromRow(row: FeatureRow): HikeFeature {
  return { id: row[0], type: row[1], name: row[2] || FEATURE_LABELS[row[1]], lat: row[4], lon: row[3], source: FEATURE_SOURCE, extra: row[5] || {} };
}

/** The features on or near one trail, ordered by mile. */
export function featuresAlong(rows: FeatureRow[], trailId: string): TrailFeature[] {
  const out: TrailFeature[] = [];
  for (const row of rows) {
    const hit = row[6].find(([id]) => id === trailId);
    if (hit) out.push({ ...featureFromRow(row), mile: hit[1], offTrailFt: Math.round(hit[2] * 3.28084) });
  }
  return out.sort((a, b) => a.mile - b.mile);
}
