# Hyked public trail catalog

This directory ships a local, server-readable snapshot. The browser receives paginated results, never the complete index of 146,355 trails. No account, database connection, or API key is required.

**The count describes trail sections, not distinct end-to-end hikes.** Multiple sections may have the same trail name, and differently named source features may overlap. These records must not be converted automatically into full-trip recommendations or treated as verified trailheads.

`current.json` points to the complete snapshot directory. Its manifest records exact source counts, selection queries, exclusions, retrieval times, regions, and the compressed index SHA-256. Geometry is split into 64 compressed files and read only for trail details. Preserve all these files in deployments; Next's file tracing includes the directory.

## Sources and licenses

- [USGS National Transportation Dataset](https://www.usgs.gov/national-digital-trails/how-access-or-view-usgs-trails-dataset): public domain. Named sections plus unnamed sections tagged `hikerpedestrian=Y` (labeled "Unnamed trail"). Source IDs are permanent identifiers; individual source links refer to the source snapshot's ArcGIS object ID.
- [Parks Canada Trails APCA](https://open.canada.ca/data/en/dataset/64a90e8d-5bc0-4027-8645-b5881b4068d4): the currently published Temporary/Temporaire public layer (all activities). Contains information licensed under the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada). The current layer has limited coverage in Alberta and British Columbia. Object IDs belong to this source snapshot and could change if the publisher replaces the layer.
- [Ontario Trail Network](https://data.ontario.ca/en/dataset/ontario-trail-network): named trail segments. Contains information licensed under the [Open Government Licence – Ontario](https://www.ontario.ca/page/open-government-licence-ontario). Stable OGF IDs identify records. This expands the Canadian selection; it does not provide every Canadian province or territory.
- [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/): public-domain 1:50m state/province boundaries used for approximate region labels. `regions.geojson` contains only Canada and the United States, from [the author's source repository](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_admin_1_states_provinces.geojson). Generalized coastline boundaries can leave some locations unassigned. Ontario records use their known source jurisdiction.

Source agencies do not endorse Hyked. Source data can predate retrieval. Access, closures, water, camping permission, elevation and missing difficulty are not invented. Geometry is simplified by the source service to approximately 0.0001 degrees, then stored to five decimal places. It is suitable for discovery, not navigation. USGS distances are source-reported; Ontario kilometers are converted to miles; Parks Canada section lengths are estimated from the generalized geometry.

## Reproduce or refresh

Run `npm run source:trails` from the repository root. The importer fetches pages sequentially, retries temporary failures, caches raw responses in ignored `.cache/trail-catalog/`, rejects invalid geometry, and deduplicates source IDs and exact matching name/geometry within each country. A partial import never replaces the current snapshot. All eligible sections are fetched and then merged into whole trails (`src/lib/trail-catalog/merge.ts`): sections with the same country and normalized name whose lines come within 200 m are one trail, and named through-hikes (Appalachian, Pacific Crest, Continental Divide, …) are one trail even across mapping gaps. Unnamed sections never merge. Trail length is the sum of section lengths with overlapping stretches counted once; USGS-reported miles are kept only when they agree with the mapped line (0.67–1.5×), otherwise, and for all Canadian sections, length is measured from geometry. Standalone trails under 0.05 mi are dropped as mapping fragments. `aliases-XX.json.gz` maps every merged section id to its trail id so old section links redirect. This is not a claim of comprehensive coverage.

## Official agency sources

The builder also reads the U.S. Forest Service National Forest System Trails (land trails where hiking is an allowed use or has a managed season; official trail numbers kept) and BLM transportation data (routes managed for non-motorized or foot-and-horse use), alongside NPS. USGS is imported first so trail ids stay stable. An agency line that repeats a catalog line (exactly, or within 25 m for ≥60% of its length) is attached to that trail as a confirming source and its id redirects there; only unmapped lines become new trails. Lines on Forest Service trails that don't allow hiking are rejected. Every trail carries `sourceType`, `confidence` (VERIFIED, OFFICIAL_GEOMETRY_VERIFIED when a second official dataset maps it, NEEDS_REVIEW, REJECTED), `trailType` and `trailStatus`; `manifest.coverage` has per-agency counts.

## Added mountain trails

- **National Park Service** ([NPS Public Trails](https://public-nps.opendata.arcgis.com/), public domain): only trails NPS lists as existing, official and open (not unofficial, unmaintained, sidewalk, water or snow trails). A line already in the catalog within 25 m for ≥60% of its length is a duplicate and skipped (93% were). New NPS-only trails must be ≥0.3 mi and in mountain terrain: sampled ground elevation (Copernicus DEM via Open-Meteo) varies ≥100 m within 1 km, or the trail climbs ≥60 m. Their sampled elevation range is shown. NPS lines that join an existing trail fill its gaps.
- **Ski resort summer trails** (`resort-trails.json`, `npm run source:resorts`): names and stated lengths from each resort's official summer hiking page or trail map, with the page URL. Resorts don't publish coordinates, so these have no route line; the pin marks the resort base area (Wikipedia coordinates). Each entry is checked: stated length ≥0.3 mi, and either a quote from the page names it or a fetch of the page finds the name and length together. Trails off the resort, bike-only trails, search-snippet figures and anything already mapped nearby are left out.

## Ski runs and start points

- `npm run source:ski` caches the U.S./Canadian pistes from [OpenSkiMap](https://openskimap.org) (ODbL, © OpenStreetMap contributors). At build, a record whose line follows a downhill piste for ≥60% of its length (within 30 m and heading the same way, so switchbacks across a slope don't count) gets `winterUse: "downhill"` and `skiArea`, and is listed only under Ski, not hiking. Names that say hike/nature/walk keep a trail hikeable. Records on Nordic tracks get `winterUse: "nordic"` and stay hikeable.
- `npm run source:trailheads` caches OpenStreetMap `highway=trailhead` points for North America. At build, the nearest one within 800 m of either trail end becomes `trailhead`, the default start point on trail pages. Public Overpass is too slow and unreliable for page views, so there is no live lookup. Coverage is only as good as OSM; trails without one start at a mapped end.
- Trail pages give on-trail steps from the geometry, links to Google Maps and Apple Maps, and built-in driving directions from `/api/directions` (OSRM; the public demo server is for light use, so set `ROUTING_API_URL` for production traffic).

## Quality checks

Every trail is checked against `config/trail-quality.json` when the snapshot is built (`src/lib/trail-catalog/quality.ts`, `audit.ts`). Distances are measured along the full mapped line; nothing is padded or defaulted. Each record gets a `quality` status and `flags`:

- `ok` / `short`: published. Short trails (under ~500 m) stay available and show meters instead of "<0.1 mi".
- `review`: published with a warning (closed, gaps, straight-line jumps, or source distance that disagrees with the map; `reportedMiles` keeps the source value).
- `fragment`: a disconnected piece of a longer same-name trail (`parentId` links it), an unnamed stub, a connector, or one piece of an agency-wide name like "Loudoun County Trails". Kept and linkable, but excluded from default search and the map unless `includeFragments=true`. Pieces are never joined across source gaps.

Sidewalks are flagged `sidewalk` and left out of hiking, running and backpacking results (they stay under biking and with `includeFragments=true`). A record counts when its name says sidewalk, sidepath, cycle track or bike lane; when it is a numbered or lettered street ("5th St.", "B St."); or when it is a plain street name ("Main Street", "Oak Avenue") that is not a nickname ("The Boulevard", "Bill's Boulevard") and not from the Forest Service, BLM or a wildlife agency. Named walks (riverwalk, boardwalk, promenade, waterfront, greenway, towpath, "… Trail") always stay.

Placeholder names ("-", "<unnamed>", "Unknown", "TEMP") are shown as Unnamed trail, keep the source name in `originalName`, and never merge. `audit.json.gz` in each snapshot holds the report shown at `/admin/trail-quality`; `npm run audit:trails [snapshot]` re-audits a snapshot read-only.

Run `npm run source:trails -- --refresh` to fetch new responses. Once complete, restart the app (or deploy a new build) to load the new immutable snapshot. Older snapshot directories may then be removed. A provider changing records during pagination can affect the snapshot; counts, checksums and duplicate exclusions document what was actually accepted.

Run `npm test` to check search boundaries, count consistency, source links, IDs and every geometry shard. `GET /api/trail-catalog` supports `q`, `country=US|CA`, `region`, `page`, `limit` (maximum 48), `minMiles`, `maxMiles`, `difficulty`, `dogFriendly`, and optional point/radius filtering. `GET /api/trail-catalog/download` exports the compressed index. The catalog is not silently inserted into Supabase.

Catalog maps use interactive OpenStreetMap raster tiles with visible attribution and browser caching, under the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/). There is no tile prefetch or offline map download. Set `NEXT_PUBLIC_CATALOG_TILE_URL` and `NEXT_PUBLIC_CATALOG_TILE_ATTRIBUTION` to use another licensed provider.
