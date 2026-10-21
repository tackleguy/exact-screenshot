import type { CatalogTrail } from "./types";
import { PACK_TRAILS } from "@/lib/gear";

/** National Scenic / major long trails matched in USGS/Ontario section names. */
export const THROUGH_HIKE_PATTERNS: {
  id: string;
  name: string;
  country: string;
  region: string | null;
  officialMiles: number;
  match: RegExp;
  sourceUrl: string;
}[] = [
  {
    id: "route-at",
    name: "Appalachian Trail",
    country: "US",
    region: "Georgia to Maine",
    officialMiles: 2190,
    match: /\bappalachian(\s+national)?\s+scenic\s+trail\b|\bappalachian\s+trail\b/i,
    sourceUrl: "https://www.nps.gov/appa/index.htm",
  },
  {
    id: "route-pct",
    name: "Pacific Crest Trail",
    country: "US",
    region: "California · Oregon · Washington",
    officialMiles: 2650,
    match: /\bpacific\s+crest(\s+national)?\s+scenic\s+trail\b|\bpacific\s+crest\s+trail\b/i,
    sourceUrl: "https://www.pcta.org/",
  },
  {
    id: "route-cdt",
    name: "Continental Divide Trail",
    country: "US",
    region: "New Mexico to Montana",
    officialMiles: 3100,
    match: /\bcontinental\s+divide(\s+national)?\s+scenic\s+trail\b|\bcontinental\s+divide\s+trail\b|^continental\s+divide$/i,
    sourceUrl: "https://continentaldividetrail.org/",
  },
  {
    id: "route-pnt",
    name: "Pacific Northwest Trail",
    country: "US",
    region: "Montana to Washington",
    officialMiles: 1200,
    match: /\bpacific\s+northwest(\s+national)?\s+scenic\s+trail\b|\bpacific\s+northwest\s+trail\b/i,
    sourceUrl: "https://www.pnt.org/",
  },
  {
    id: "route-nct",
    name: "North Country Trail",
    country: "US",
    region: "North Dakota to Vermont",
    officialMiles: 4800,
    match: /\bnorth\s+country(\s+national)?\s+scenic\s+trail\b|\bnorth\s+country\s+trail\b/i,
    sourceUrl: "https://northcountrytrail.org/",
  },
  {
    id: "route-flt",
    name: "Florida Trail",
    country: "US",
    region: "Florida",
    officialMiles: 1500,
    match: /\bflorida(\s+national)?\s+scenic\s+trail\b/i,
    sourceUrl: "https://floridatrail.org/",
  },
  {
    id: "route-azt",
    name: "Arizona Trail",
    country: "US",
    region: "Arizona",
    officialMiles: 800,
    match: /\barizona(\s+national)?\s+scenic\s+trail\b/i,
    sourceUrl: "https://aztrail.org/",
  },
  {
    id: "route-iat",
    name: "Ice Age Trail",
    country: "US",
    region: "Wisconsin",
    officialMiles: 1200,
    match: /\bice\s+age(\s+national)?\s+scenic\s+trail\b/i,
    sourceUrl: "https://www.iceagetrail.org/",
  },
  {
    id: "route-tct",
    name: "Trans Canada Trail",
    country: "CA",
    region: "Canada",
    officialMiles: 16700,
    match: /\btrans[\s-]?canada\s+trail\b|\bthe\s+great\s+trail\b/i,
    sourceUrl: "https://thegreattrail.ca/",
  },
  {
    id: "route-sht",
    name: "Superior Hiking Trail",
    country: "US",
    region: "Minnesota",
    officialMiles: 310,
    match: /^superior\s+hiking\s+trail$/i,
    sourceUrl: "https://superiorhiking.org/",
  },
  {
    id: "route-ct",
    name: "Colorado Trail",
    country: "US",
    region: "Colorado",
    officialMiles: 486,
    match: /^(the\s+)?colorado\s+trail$/i,
    sourceUrl: "https://coloradotrail.org/",
  },
  {
    id: "route-trt",
    name: "Tahoe Rim Trail",
    country: "US",
    region: "California · Nevada",
    officialMiles: 165,
    match: /^tahoe\s+rim\s+trail$/i,
    sourceUrl: "https://tahoerimtrail.org/",
  },
  {
    id: "route-pht",
    name: "Potomac Heritage Trail",
    country: "US",
    region: "DC · Maryland · Virginia · Pennsylvania",
    officialMiles: 710,
    match: /\bpotomac\s+heritage\b/i,
    sourceUrl: "https://www.nps.gov/pohe/",
  },
  {
    id: "route-nst-ne",
    name: "New England Trail",
    country: "US",
    region: "Connecticut · Massachusetts",
    officialMiles: 235,
    match: /\bnew\s+england(\s+national\s+scenic)?\s+trail\b|\bmetacomet\b|\bmattabesett\b/i,
    sourceUrl: "https://newenglandtrail.org/",
  },
  {
    id: "route-lt",
    name: "Long Trail",
    country: "US",
    region: "Vermont",
    officialMiles: 272,
    match: /^(the\s+)?long\s+trail$/i,
    sourceUrl: "https://www.greenmountainclub.org/the-long-trail/",
  },
  {
    id: "route-bmt",
    name: "Benton MacKaye Trail",
    country: "US",
    region: "Georgia · Tennessee · North Carolina",
    officialMiles: 288,
    match: /\bbenton\s+mackaye\b/i,
    sourceUrl: "https://bmta.org/",
  },
  {
    id: "route-oht",
    name: "Ozark Highlands Trail",
    country: "US",
    region: "Arkansas",
    officialMiles: 218,
    match: /\bozark\s+highlands\s+trail\b/i,
    sourceUrl: "https://www.ozarkhighlandstrail.com/",
  },
  {
    id: "route-sheltowee",
    name: "Sheltowee Trace",
    country: "US",
    region: "Kentucky · Tennessee",
    officialMiles: 343,
    match: /\bsheltowee\b/i,
    sourceUrl: "https://sheltoweetrace.org/",
  },
  {
    id: "route-bruce",
    name: "Bruce Trail",
    country: "CA",
    region: "Ontario",
    officialMiles: 560,
    match: /^bruce\s+trail/i,
    sourceUrl: "https://brucetrail.org/",
  },
  {
    id: "route-rideau",
    name: "Rideau Trail",
    country: "CA",
    region: "Ontario",
    officialMiles: 240,
    match: /\brideau\s+trail\b/i,
    sourceUrl: "https://www.rideautrail.org/",
  },
  {
    id: "route-jmt",
    name: "John Muir Trail",
    country: "US",
    region: "California",
    officialMiles: 211,
    match: /\bjohn\s+muir\s+trail\b/i,
    sourceUrl: "https://www.nps.gov/seki/planyourvisit/the-john-muir-trail.htm",
  },
  {
    id: "route-mst",
    name: "Mountains-to-Sea Trail",
    country: "US",
    region: "North Carolina",
    officialMiles: 1175,
    match: /\bmountains\s+to\s+sea\b/i,
    sourceUrl: "https://mountainstoseatrail.org/",
  },
  {
    id: "route-pinhoti",
    name: "Pinhoti Trail",
    country: "US",
    region: "Alabama · Georgia",
    officialMiles: 335,
    match: /\bpinhoti\b/i,
    sourceUrl: "https://www.pinhotitrailalliance.org/",
  },
  {
    id: "route-buckeye",
    name: "Buckeye Trail",
    country: "US",
    region: "Ohio",
    officialMiles: 1444,
    match: /\bbuckeye\s+trail\b/i,
    sourceUrl: "https://www.buckeyetrail.org/",
  },
  {
    id: "route-gwt",
    name: "Great Western Trail",
    country: "US",
    region: "Arizona to Montana",
    officialMiles: 4455,
    match: /\bgreat\s+western\s+trail\b/i,
    sourceUrl: "https://www.greatwesterntrail.org/",
  },
  {
    id: "route-mid-state",
    name: "Mid State Trail",
    country: "US",
    region: "Pennsylvania",
    officialMiles: 327,
    match: /\bmid\s+state\s+trail\b/i,
    sourceUrl: "https://hike-mst.org/",
  },
  {
    id: "route-npt",
    name: "Northville-Placid Trail",
    country: "US",
    region: "New York",
    officialMiles: 138,
    match: /\bnorthville\b/i,
    sourceUrl: "https://www.dec.ny.gov/",
  },
];

/** Lowercase ASCII name with punctuation collapsed, so source spelling variants compare equal. */
export function normalizeTrailName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+def$/, "")
    .trim();
}

/** The through-hike a section or trail name belongs to, if any. */
export function matchThroughHike(name: string) {
  const normalized = normalizeTrailName(name);
  return THROUGH_HIKE_PATTERNS.find((pattern) => pattern.match.test(normalized)) ?? null;
}

/** Prefer keeping these sections when sampling the USGS universe. */
export function isPriorityThroughHikeSection(name: string): boolean {
  return matchThroughHike(name) !== null;
}

type GuideMeta = {
  country: string;
  region: string | null;
  lat: number;
  lng: number;
  sourceUrl: string;
};

/** Approximate trailheads for curated international / classic guides (not GPS tracks). */
const GUIDE_META: Record<string, GuideMeta> = {
  "John Muir Trail": {
    country: "US",
    region: "California",
    lat: 36.5785,
    lng: -118.292,
    sourceUrl: "https://www.nps.gov/seki/planyourvisit/the-john-muir-trail.htm",
  },
  "Appalachian Trail": {
    country: "US",
    region: "Georgia to Maine",
    lat: 34.6268,
    lng: -84.1937,
    sourceUrl: "https://www.nps.gov/appa/index.htm",
  },
  "Tour du Mont Blanc": {
    country: "FR",
    region: "France · Italy · Switzerland",
    lat: 45.9237,
    lng: 6.8694,
    sourceUrl: "https://www.autourdumontblanc.com/",
  },
  "Wonderland Trail": {
    country: "US",
    region: "Washington",
    lat: 46.8523,
    lng: -121.7603,
    sourceUrl: "https://www.nps.gov/mora/planyourvisit/wonderland-trail.htm",
  },
  "West Coast Trail": {
    country: "CA",
    region: "British Columbia",
    lat: 48.65,
    lng: -124.72,
    sourceUrl: "https://parks.canada.ca/pn-np/bc/pacificrim/activ/wct-tso",
  },
  Kungsleden: {
    country: "SE",
    region: "Swedish Lapland",
    lat: 68.358,
    lng: 18.783,
    sourceUrl: "https://www.svenskaturistforeningen.se/en/boende/stf-kungsleden/",
  },
  "Torres del Paine W Trek": {
    country: "CL",
    region: "Patagonia",
    lat: -50.942,
    lng: -73.407,
    sourceUrl: "https://www.parquedetorresdelpaine.cl/",
  },
  "Laugavegur Trail": {
    country: "IS",
    region: "Iceland",
    lat: 63.983,
    lng: -19.061,
    sourceUrl: "https://www.fi.is/en/hiking-trails/laugavegur",
  },
  "Pacific Crest Trail": {
    country: "US",
    region: "California · Oregon · Washington",
    lat: 32.593,
    lng: -116.467,
    sourceUrl: "https://www.pcta.org/",
  },
  "Haute Route": {
    country: "CH",
    region: "Chamonix to Zermatt",
    lat: 45.9237,
    lng: 6.8694,
    sourceUrl: "https://en.wikipedia.org/wiki/Haute_Route",
  },
  "Lost Coast Trail": {
    country: "US",
    region: "California",
    lat: 40.017,
    lng: -124.069,
    sourceUrl: "https://www.blm.gov/visit/lost-coast-trail",
  },
  "Grand Canyon Rim-to-Rim": {
    country: "US",
    region: "Arizona",
    lat: 36.057,
    lng: -112.143,
    sourceUrl: "https://www.nps.gov/grca/planyourvisit/rim-to-rim.htm",
  },
  "Annapurna Circuit": {
    country: "NP",
    region: "Nepal",
    lat: 28.597,
    lng: 83.931,
    sourceUrl: "https://www.tourism.gov.np/",
  },
  "Inca Trail": {
    country: "PE",
    region: "Peru",
    lat: -13.1631,
    lng: -72.545,
    sourceUrl: "https://www.gob.pe/institucion/cultura",
  },
  "Milford Track": {
    country: "NZ",
    region: "Fiordland",
    lat: -44.672,
    lng: 167.926,
    sourceUrl: "https://www.doc.govt.nz/parks-and-recreation/places-to-go/fiordland/places/fiordland-national-park/things-to-do/tracks/milford-track/",
  },
  GR20: {
    country: "FR",
    region: "Corsica",
    lat: 42.15,
    lng: 9.05,
    sourceUrl: "https://www.pnrc.corsica/",
  },
  "Overland Track": {
    country: "AU",
    region: "Tasmania",
    lat: -41.87,
    lng: 146.05,
    sourceUrl: "https://parks.tas.gov.au/explore-by-activity/walking/overland-track",
  },
  "Dolomites Alta Via 1": {
    country: "IT",
    region: "Dolomites",
    lat: 46.54,
    lng: 12.08,
    sourceUrl: "https://www.altaviadolomiti.it/",
  },
  "Kilimanjaro Machame Route": {
    country: "TZ",
    region: "Tanzania",
    lat: -3.0674,
    lng: 37.3556,
    sourceUrl: "https://www.tanzaniaparks.go.tz/",
  },
  "Camino de Santiago Francés": {
    country: "ES",
    region: "Spain",
    lat: 43.163,
    lng: -1.235,
    sourceUrl: "https://www.caminodesantiago.gal/",
  },
  "Mount Olympus E4": {
    country: "GR",
    region: "Greece",
    lat: 40.085,
    lng: 22.358,
    sourceUrl: "https://www.olympusfd.gr/",
  },
  "Lycian Way": {
    country: "TR",
    region: "Turkey",
    lat: 36.62,
    lng: 30.47,
    sourceUrl: "https://www.cultureroutesinturkey.com/lycian-way/",
  },
  "Snowman Trek": {
    country: "BT",
    region: "Bhutan",
    lat: 27.514,
    lng: 90.434,
    sourceUrl: "https://www.tourism.gov.bt/",
  },
  "Zion Narrows Top-Down": {
    country: "US",
    region: "Utah",
    lat: 37.396,
    lng: -112.9,
    sourceUrl: "https://www.nps.gov/zion/planyourvisit/thenarrows.htm",
  },
  "Kalalau Trail": {
    country: "US",
    region: "Hawaii",
    lat: 22.172,
    lng: -159.66,
    sourceUrl: "https://dlnr.hawaii.gov/dsp/parks/kauai/haena-state-park/",
  },
  "Drakensberg Grand Traverse": {
    country: "ZA",
    region: "South Africa",
    lat: -29.12,
    lng: 29.35,
    sourceUrl: "https://www.sanparks.org/",
  },
  "The Enchantments Thru-Hike": {
    country: "US",
    region: "Washington",
    lat: 47.49,
    lng: -120.82,
    sourceUrl: "https://www.fs.usda.gov/recarea/okawen/recarea/?recid=57333",
  },
  "Huemul Circuit": {
    country: "AR",
    region: "Patagonia",
    lat: -49.3,
    lng: -72.9,
    sourceUrl: "https://www.argentina.gob.ar/parquesnacionales",
  },
  "King's Peak via Henry's Fork": {
    country: "US",
    region: "Utah",
    lat: 40.776,
    lng: -110.373,
    sourceUrl: "https://www.fs.usda.gov/uwcnf",
  },
  "Teton Crest Trail": {
    country: "US",
    region: "Wyoming",
    lat: 43.74,
    lng: -110.8,
    sourceUrl: "https://www.nps.gov/grte/planyourvisit/tetoncrest.htm",
  },
  "Wind River High Route": {
    country: "US",
    region: "Wyoming",
    lat: 43.12,
    lng: -109.6,
    sourceUrl: "https://www.fs.usda.gov/btnf",
  },
};

function slug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/** Curated through-hikes (international + classics) as catalog route records. */
export function curatedThroughHikes(): CatalogTrail[] {
  return PACK_TRAILS.map((trail) => {
    const meta = GUIDE_META[trail.name];
    const country = meta?.country ?? "US";
    const id = `route-guide-${slug(trail.name)}`;
    return {
      id,
      name: trail.name,
      country,
      region: meta?.region ?? trail.location,
      kind: "route" as const,
      miles: trail.distance,
      distanceBasis: "source" as const,
      latitude: meta?.lat ?? 0,
      longitude: meta?.lng ?? 0,
      difficulty: trail.difficulty,
      dogs: null,
      source: "guide" as const,
      sourceId: slug(trail.name),
      sourceUrl: meta?.sourceUrl ?? "https://hikesync.app/explore/trails",
      officialUrl: meta?.sourceUrl ?? null,
      sourceDate: null,
      manager: null,
      surface: null,
      season: trail.season,
      geometryShard: "route",
      tags: trail.tags,
      note: "Curated through-hike guide. Confirm distance, permits, and current conditions with the land manager or official trail association.",
    };
  });
}

/**
 * Aggregate mapped trails into through-hike route cards.
 * Official miles are the known end-to-end length; mapped miles are the sum of the catalog trails.
 */
export function aggregateThroughHikes(sections: CatalogTrail[]): CatalogTrail[] {
  const byPattern = new Map<string, CatalogTrail[]>();
  for (const row of sections) {
    if (row.kind === "route") continue;
    const pattern = matchThroughHike(row.name);
    if (pattern && pattern.country === row.country) byPattern.set(pattern.id, [...(byPattern.get(pattern.id) ?? []), row]);
  }
  const routes: CatalogTrail[] = [];
  for (const pattern of THROUGH_HIKE_PATTERNS) {
    const matches = byPattern.get(pattern.id);
    if (!matches) continue;
    const mappedMiles = matches.reduce((sum, row) => sum + (row.miles ?? 0), 0);
    const sectionCount = matches.reduce((sum, row) => sum + (row.sectionCount ?? 1), 0);
    const longest = matches.reduce((best, row) => ((row.miles ?? 0) > (best.miles ?? 0) ? row : best), matches[0]);
    routes.push({
      id: pattern.id,
      name: pattern.name,
      country: pattern.country,
      region: pattern.region,
      kind: "route",
      miles: pattern.officialMiles,
      distanceBasis: "source",
      latitude: longest.latitude,
      longitude: longest.longitude,
      difficulty: null,
      dogs: null,
      source: "route-aggregate",
      sourceId: pattern.id,
      sourceUrl: pattern.sourceUrl,
      officialUrl: pattern.sourceUrl,
      sourceDate: null,
      manager: null,
      surface: null,
      season: null,
      geometryShard: "route",
      sectionCount,
      mappedMiles: Math.round(mappedMiles * 10) / 10,
      memberIds: matches.map((row) => row.id),
      note: `${sectionCount.toLocaleString("en-US")} mapped sections (~${mappedMiles.toFixed(0)} mi) are joined on this map. The official trail is about ${pattern.officialMiles.toLocaleString("en-US")} mi — mapped coverage can be incomplete.`,
    });
  }
  return routes;
}

/** Prefer unique display names: keep longest section per normalized name+country. */
export function dedupeSectionsByName(rows: CatalogTrail[]): CatalogTrail[] {
  const best = new Map<string, CatalogTrail>();
  for (const row of rows) {
    if (row.kind === "route") {
      best.set(row.id, row);
      continue;
    }
    const key = `${row.country}:${row.name.trim().toLowerCase()}`;
    const existing = best.get(key);
    if (!existing) {
      best.set(key, row);
      continue;
    }
    const existingMiles = existing.miles ?? 0;
    const nextMiles = row.miles ?? 0;
    if (nextMiles > existingMiles) best.set(key, row);
  }
  return [...best.values()];
}

function normalizeName(name: string) {
  return name.trim().toLowerCase();
}

/**
 * Curated guides + aggregates from mapped sections.
 * Aggregates win when both exist for the same trail name (richer coverage note).
 */
export function buildThroughHikeOverlay(sections: CatalogTrail[]): CatalogTrail[] {
  const byName = new Map<string, CatalogTrail>();
  for (const guide of curatedThroughHikes()) {
    byName.set(normalizeName(guide.name), guide);
  }
  for (const route of aggregateThroughHikes(sections)) {
    byName.set(normalizeName(route.name), route);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
