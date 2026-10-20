# Hyked API

The Hyked backend is this Next.js app. Its `/api/*` routes are a public, read-only JSON API that any frontend (the Hyked Lovable app) can call from the browser. CORS is open by default; set `CORS_ORIGINS` (comma-separated) to restrict it. Accounts, saved gear, trips and recorded activities live in Supabase and are read and written by the frontend with the Supabase client, not through this API.

Base URL: the deployed app, e.g. `https://<your-app>.vercel.app`. All paths below are relative to it. Trail ids contain characters like `{}`; always `encodeURIComponent` them in paths.

Data comes from USGS, the National Park Service, U.S. Forest Service, BLM, Parks Canada, the Ontario Trail Network, ski resorts' official sites, GeoNames, OpenStreetMap contributors (water and town services, via OpenStreetMap US tiles) and AWS Terrain Tiles. Show the `attribution` strings returned by endpoints that include them.

---

## Trails

### `GET /api/trail-catalog` — search trails
Query (all optional):

| param | meaning |
|---|---|
| `q` | text: trail, park, forest, town, state |
| `country` | `US`, `CA`, or `intl` (curated international guides) |
| `region` | state/province name, e.g. `Colorado` |
| `activity` | `hike` (default), `backpack`, `bike`, `run`, `ski`, `all` |
| `kind` | `segment` (trails) or `route` (through-hikes) |
| `minMiles`, `maxMiles`, `targetMiles` | length filters / sort by closeness to a target |
| `difficulty` | `easy`, `moderate`, `hard` |
| `dogFriendly` | `true` |
| `lat`, `lng`, `radiusKm` | near a point (sorted by distance) |
| `bbox` | `west,south,east,north` |
| `resort` | ski resort name, e.g. `Alta` (resort-listed summer trails) |
| `sourceType` | `NPS_OFFICIAL`, `USFS_OFFICIAL`, `BLM_OFFICIAL`, `STATE_AGENCY`, `LOCAL_AGENCY`, `SKI_RESORT_OFFICIAL`, … |
| `includeFragments` | `true` to include hidden records (pieces, sidewalks, motorized, ski runs) |
| `uniqueNames` | `true` to keep one trail per name |
| `page`, `limit` | pagination (`limit` ≤ 48) |

Response: `{ trails: Trail[], total, page, pages, limit, manifest }`.

`Trail` (key fields):
```ts
{
  id: string;                 // stable; old ids redirect
  name: string;
  country: "US" | "CA" | string;
  region: string | null;      // state / province
  kind: "segment" | "route";  // route = through-hike or curated guide
  miles: number | null;
  latitude: number; longitude: number;   // a point on the trail (not a trailhead)
  difficulty: string | null;  // only when the source states it
  dogs: boolean | null;
  source: "usgs" | "nps" | "usfs" | "blm" | "parks-canada" | "ontario" | "resort" | "guide" | "route-aggregate";
  sourceType?: "NPS_OFFICIAL" | "USFS_OFFICIAL" | "BLM_OFFICIAL" | "PARKS_CANADA_OFFICIAL" | "STATE_AGENCY" | "LOCAL_AGENCY" | "VERIFIED_ORGANIZATION" | "SKI_RESORT_OFFICIAL" | "USGS_NTD" | "CURATED_GUIDE";
  confidence?: "VERIFIED" | "OFFICIAL_GEOMETRY_VERIFIED" | "NEEDS_REVIEW" | "REJECTED";
  trailType?: "hiking" | "nature" | "backpacking" | "accessible" | "boardwalk" | "scenic" | "multi-use" | "resort-hiking";
  trailStatus?: "OPEN" | "CLOSED" | "SEASONAL" | "RESTRICTED" | "UNKNOWN";
  routeType?: "loop" | "point-to-point" | "network";
  quality?: "ok" | "short" | "review" | "fragment";
  flags?: string[];           // e.g. "short", "closed", "sidewalk", "motorized", "fragment-of-longer-trail"
  officialTrailId?: string;   // e.g. Forest Service trail number
  park?: string; forest?: string; blmArea?: string; skiResort?: string;
  uses?: string[];            // officially allowed uses, e.g. ["Hiking","Horses","Bikes"]
  trailhead?: { name: string | null; latitude: number; longitude: number; toTrailMeters: number; source?: "osm" | "usfs"; water?: string; closestTowns?: string; officialUrl?: string; osmUrl?: string };
  elevationFt?: { min: number; max: number };
  winterUse?: "downhill" | "nordic"; skiArea?: string;
  sources?: { type: string; id: string; url: string; name: string; officialTrailId?: string; unit?: string }[]; // other official datasets that map the same line
  sourceUrl: string; officialUrl: string | null; manager: string | null;
  surface: string | null; season: string | null; sourceDate: string | null;
  note?: string; tags?: string[];
}
```

### `GET /api/trail-catalog/map` — map points
Same filters as search. Returns `{ points: { id, latitude, longitude, count, bounds?, trail? }[], total, bounds, grouped }`. When `grouped` is true, points with `count > 1` are clusters: zoom to `bounds`.

### `GET /api/trail-catalog/{id}` — one trail with its line
Returns `{ trail: Trail, lines: [lng, lat][][] }`. `lines` is empty for resort-listed trails and guides without a mapped route. Draw `lines` as a multi-line on the map.

### `GET /api/trail-catalog/{id}/elevation`
`{ profile: [mile, feet][], gainFt, lossFt, minFt, maxFt, trailMiles, attribution }`. 422 when the trail has no mapped line.

### `GET /api/trail-catalog/{id}/water`
```ts
{
  sources: { kind: "tap" | "spring" | "river" | "stream" | "lake"; name: string | null; mile: number; offTrailMeters: number;
             crossing: boolean; reliability: "potable" | "treat" | "seasonal"; latitude: number; longitude: number }[];
  longestDryMiles: number;   // longest stretch between dependable sources
  trailMiles: number; partial: boolean; attribution: string; notes: string[];
}
```
`potable` = mapped drinking-water tap (may be off seasonally); `treat` = natural water to filter; `seasonal` = mapped intermittent stream.

### `GET /api/trail-catalog/{id}/towns?maxMilesOff=15&limit=6`
`{ towns: Town[], maxMilesOff, attribution }` where
```ts
Town = { id: number; name: string; state: string; country: string; latitude: number; longitude: number; population: number;
         trailMile: number;      // trail mile closest to town
         milesOffTrail: number;  // straight-line
         services: { counts: Partial<Record<Service, number>>; places: Partial<Record<Service, { name: string; latitude: number; longitude: number }[]>>; radiusKm: number } | null }
Service = "grocery" | "outfitter" | "post" | "lodging" | "campground" | "laundry" | "fuel" | "food" | "pharmacy" | "medical" | "money" | "library"
```

### `GET /api/trail-catalog/{id}/town-days` — resupply plan ("town days")
Query: `days` (required, hiking days), `startDate` (YYYY-MM-DD), `maxCarryDays` (default 5), `foodLbPerDay` (default 1.75), `maxMilesOffTrail` (default 15), `zeroDays` (`true` for full rest days). `POST` the same fields as JSON, plus `consumables: string[]` to add restock reminders.
```ts
{
  trailId, trailMiles, milesPerDay, foodLbPerDay, startFoodDays, startFoodLb, totalDays,
  stops: { town: Town; services: Town["services"]; trailMile: number; arriveDay: number; date: string | null; kind: "nero" | "zero";
           foodDays: number; foodLb: number; checklist: string[]; warnings: string[] }[],
  gaps: { fromMile: number; toMile: number; days: number }[],   // no town in reach: mail a box
  notes: string[], attribution: string
}
```
422 when the trail has no line or is too little mapped to place towns (most through-hikes other than the AT).

### `GET /api/trail-catalog/{id}/download?format=…` — downloads
`format`: `gpx` (trail + water/town/trailhead waypoints), `csv` (water list), `html` (printable trip packet), `json` (trail + lines + water + towns + elevation + plan). Add the town-days query params to include a resupply plan.

### `POST /api/trips/packet` — trip packet with the user's pack list
JSON body: `{ trailId, format: "html" | "json" | "gpx" | "csv", days?, startDate?, maxCarryDays?, foodLbPerDay?, maxMilesOffTrail?, zeroDays?, pack?: { name, quantity?, weightOz?, category?, consumable? }[] }`. `html` returns a self-contained printable page (open it in a new tab; the user prints or saves as PDF).

### `GET /api/trail-catalog/{id}/gpx` — plain GPX of the trail line
### `GET /api/trail-catalog/{id}/photos` — nearby Wikimedia Commons photos (with license and credit)

---

## Places, routing, weather

| endpoint | returns |
|---|---|
| `GET /api/directions?from=lat,lng&to=lat,lng` | `{ distanceMeters, durationSeconds, line: [lng,lat][], steps: { instruction, distanceMeters }[], attribution }` (driving, OSRM). Rate-limited; also offer Google Maps: `https://www.google.com/maps/dir/?api=1&destination=lat,lng` |
| `GET /api/assistant/places?q=` | `{ places: { id, name, latitude, longitude }[] }` (U.S./Canada geocoding) |
| `GET /api/weather/forecast?lat=&lng=` | 7-day forecast (NWS in the U.S., Open-Meteo elsewhere) |
| `GET /api/ski/nearby?lat=&lng=` or `?q=` | ski areas |

## Catalog info

| endpoint | returns |
|---|---|
| `GET /api/meta` | `{ name, trails, records, generatedAt, countries, sources[], coverage, confidence, notes[] }` |
| `GET /api/resorts` | `{ resorts: { name, state, latitude, longitude, sourceUrl, listedTrails, trailsInCatalog, browse }[] }` |
| `GET /api/trail-catalog/download` | the full compressed index (`application/gzip`) |

## Admin (secret-protected)

`POST /api/admin/trail-reviews` with header `x-admin-secret: <ADMIN_SECRET>` and body `{ trailId, decision: "approve" | "reject" | "reverse", note? }`; `GET` lists recent decisions. Needs the Supabase service role and the `trail_review_decisions` table (`supabase/migrations/20261020000001_*`).

## Errors and caching

Errors are `{ error: string }` with a 4xx/5xx status and a sentence that can be shown to users. Water, towns and elevation can take a few seconds the first time for a trail (longer for very long trails) and are cached afterwards; show a loading state.
