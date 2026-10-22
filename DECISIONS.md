# Decisions

Choices made while rebuilding Hyked's trail data and app, and why. Numbers marked "(build)" come from the latest
`npm run pipeline` run and are repeated in `data/trail-catalog/<snapshot>/build-report.json`.

## Data pipeline

- **Location and language.** The pipeline lives in `/pipeline` with a single entry point (`npm run pipeline`,
  see `pipeline/README.md`). It is TypeScript (Node 20) so it shares the app's matching, scoring and difficulty
  code, plus one Python step because pyosmium is the most reliable way to read OpenStreetMap PBF extracts.
  The previous `/trail-data` pipeline (`scripts/prepare-trail-assets.ts`) was kept and rewritten as the last
  step: it turns a catalog snapshot into the app's sharded files.
- **Geofabrik extracts, not Overpass.** The public Overpass instances were overloaded or refused connections
  during the build (504s on small tiles, connection refused from overpass-api.de), and a full U.S. + Canada pull
  needs thousands of queries. Geofabrik serves one extract per state/province. Each extract is streamed into
  memory and read there; at the owner's request the raw extracts are never written to disk. Only the reduced
  result (route relations, their ways and named trail ways) is cached in `.cache/osm-pbf/`.
- **Cloud runs and the OSM France mirror.** The cloud container that ran the October 2026 rebuild can't reach
  Geofabrik (connection reset by the network policy), so the U.S. and Canada came from download.openstreetmap.fr:
  four U.S. regional extracts and every province (`--mirror openstreetmap.fr`). It has no Alaska or Hawaii extract;
  those two states come from the worldwide planet step. With `--disk` the extracts and pyosmium's node index live
  on disk (the container has 16 GB of memory; a 4.6 GB regional extract needs ~9 GB of node index).
- **Worldwide from the planet file, streamed.** Every other country comes from the planet file on the AWS Open
  Data mirror (~95 GB, ~170 MB/s over parallel range requests). It is never stored: three streaming passes keep
  only route relations, the ways they use, named trail ways and pistes, their nodes and hike-feature nodes (a few
  GB), which `osmium extract` splits per country. Overpass and per-country extracts were ruled out: Overpass is
  blocked here and can't serve a planet-wide pull, and the France mirror lacks many countries (Greece, the Balkans,
  New Zealand, Nepal, Peru…).
- **Countries and regions** come from Natural Earth 1:10m admin-0/admin-1 outlines (public domain). A trail that
  crosses a border is built once, by the country holding its map pin; route relations are kept whole in each
  country's file, so the trail is complete either way.
- **Every trail type.** Route relations of every non-motorized type are kept (hiking, foot, walking, running,
  fitness, bicycle, mtb, horse, ski, piste, canoe, inline skating), and named pistes (`piste:type`) are trail
  candidates. Sled runs show under Snow → Sledding, canoe/kayak routes under the new Paddle section. Swimming has
  no trail data in OpenStreetMap (open-water swim routes are not mapped as routes), so there is no swim section.
- **State datasets.** USGS National Digital Trails already compiles the state layers that were candidates:
  Colorado Parks and Wildlife (COTREX, 4,479 trails), California Department of Parks and Recreation (2,020), Utah
  AGRC (1,583), Washington State Parks (780), and dozens more. Ingesting them separately would only add
  duplicates, so they come through USGS with their managing unit kept. No provincial layer beyond Parks Canada
  and Ontario had a stable open endpoint worth adding; OpenStreetMap fills the rest of Canada.
- **Old snapshots.** Each build writes a new `data/trail-catalog/snapshot-<time>/` and keeps the previous one
  until the new build has been generated and validated.

## Sources, matching and tiers

- Priority: OpenStreetMap route relations → official agency layers → named OpenStreetMap ways.
- **Matching:** two records are the same trail when their names agree (normalized; ≥75% of words shared) and
  ≥50% of one line lies within 100 m of the other. The merged record keeps the official name (and the official
  length when a single official record covers the relation), uses the more complete line, and lists every
  contributor in `sources[]`; absorbed ids redirect. Unmatched official trails stay as their own trails.
- **Tiers:** "verified" = an official agency record or an OSM route relation; "mapped" = named OSM ways that
  passed every verification rule. Nothing below "mapped" is shown. The headline count on the site is
  verified + mapped, exact, never rounded up.

## Verification filter

Every candidate passes these rules before it counts (counts per rule: build-report.json and the summary at the
end of this file).

| rule | rejects |
|---|---|
| R1 | Unnamed, or a generic/placeholder name ("path", "trail", "unnamed", a bare number…) without an official ID |
| R2 | Under 0.3 mi, unless an official-layer trail or a named loop inside a park or forest |
| R3 | Sidewalks, crosswalks, driveways, parking aisles, golf-cart paths (`footway=sidewalk/crossing`, `service=driveway/parking_aisle`, `golf=*`), steps-only ways, and street-name sidepaths |
| R4 | Indoor paths (`indoor`, `level`≠0, `location=indoor`, `tunnel=building_passage`) and airport/terminal/campus-corridor names |
| R5 | Roads mapped as trails: a track open to motor vehicles and not designated for foot or bikes, or a track named like a road |
| R6 | `access=private/no` (unless foot, bicycle or horse is explicitly allowed), disused/abandoned/under construction, or closed/decommissioned in the official layer |
| R7 | Duplicates: same name within 2 km with overlapping lines; the record with more sources (then the longer) is kept |
| R8 | Degenerate geometry: fewer than 3 points, under 20 m across, zig-zag self-crossings (≥3 and >4 per km), or a scribble (line >8× its extent under 1.5 km) |
| R9 | Climbing approach/descent paths not part of a named route relation |
| R10 | In open water or outside every state/province/region outline (10 km tolerance for generalized coastlines); U.S./Canada use their own state and province polygons, the rest of the world Natural Earth admin-1 |

Only `highway=path|footway|track|bridleway|cycleway` ways are candidates, so residential/service/unclassified
roads with trail-like names never enter. **Not implemented:** an exact building-footprint test (it needs every
building polygon in North America); R4 uses tags and names instead.

## Facts on trail pages

Every fact is sourced or left out; placeholder generators (fake water, towns, elevation curves, curated lines,
vertex-count lengths, packet defaults) were deleted.

- **Elevation:** sampled along the trail line from AWS Terrain Tiles (Terrarium; USGS 3DEP in the U.S., SRTM
  elsewhere), every ~25 m, gain/loss with a 4 m hysteresis to smooth DEM noise. Computed when the page opens.
- **Water:** OpenStreetMap springs, drinking water and waterway crossings/lakes along the line, each at its real
  trail mile; nothing listed when none are mapped.
- **Trailheads:** OpenStreetMap `highway=trailhead` (and USFS trailheads) within 800 m of either end; otherwise
  one line: "No mapped trailhead — check the land manager's page for access and parking".
- **Towns:** the nearest 2–3 GeoNames places (more along long trails) with straight-line distance; services
  counted from OpenStreetMap points of interest.
- **Descriptions and hero photos:** only from a Wikidata match (by OSM relation, the relation's `wikidata` tag,
  or name within 20 km), with the Wikipedia lead (CC BY-SA) and the item's Commons image with licence and author.
  "Photos from nearby" are shown lower on the page, labelled as nearby.
- **Difficulty:** one scale, Easy / Moderate / Hard / Very hard. Effort = miles + 2 × (feet of climb ÷ 1,000);
  Easy < 4, Moderate 4–9, Hard 9–16, Very hard ≥ 16; OSM `sac_scale` sets a minimum (mountain_hiking ≥ Moderate,
  demanding_mountain_hiking ≥ Hard, alpine and above = Very hard). Lists use distance and sac_scale; trail pages
  add the measured climb.
- **Estimated time:** Naismith's rule (3 mph + 1 h per 2,000 ft), only under 50 mi, with a measured climb, and
  never for summits, expeditions, 8,000 m peaks or through-hikes.
- **Route type:** from geometry: a line whose ends meet is a loop; a single line is labelled "Out and back /
  point to point" (the data can't tell whether hikers return or shuttle); several pieces form a network.
- **Guard helper:** `src/lib/display.ts` formats every number and string and returns nothing for missing, NaN
  or "undefined" values, so no section prints them.

## Hike-feature layer

- **What:** springs, drinking water, lakes and rivers within 200 m of a trail, stream and river crossings, fords,
  waterfalls, campsites and camp pitches, shelters and huts, trailheads, parking, toilets, ranger stations, picnic
  sites, viewpoints, peaks, passes and bridges, all from OpenStreetMap (the same Geofabrik extracts, a second
  pass in `pipeline/steps/extract-osm.py`). Points within 300 m of a trail are kept; crossings are computed where
  a mapped stream or river line crosses a trail line; lakes and rivers are placed at their nearest shore point.
- **Placed on trails:** `pipeline/steps/features.ts` measures each feature's mile marker along every trail it is on
  or near (the same ordering trail pages use), keeps up to 12 trails per feature, and writes 1° cell shards
  (`features/f-<cell>.json.gz`). The map loads only the cells in view from zoom 11; trail pages, water lists,
  GPX waypoints and the route builder all read the same layer, so a feature appears at the same mile everywhere.
- **NHD and agency campsites:** the USGS National Hydrography Dataset is not ingested separately: OpenStreetMap
  streams and lakes in most states were imported from NHD and have since been edited by mappers, and NHD's
  flowlines (tens of millions of segments) would multiply the build for little gain. NPS/USFS designated sites
  are covered where OpenStreetMap maps them; there is no national open layer of backcountry sites to add.
- Parking lots and bridges are shown on the map but left out of a trail page's mile-by-mile list to keep it readable.

## Ranking and search

- **Quality score** (`src/lib/trail-catalog/score.ts`): verified +15, route relation +25, official source +20,
  Wikidata +15 (+10 with an article), trailhead +8, named +10, over 1 mi +8, national network +15, regional +8,
  local +3, inside a park or forest +10; climbers' approach/descent −25, unnamed or fragment −30, under 0.25 mi
  −10, a mapped trail that barely passed the filter −10. It orders search, map lists and near-you suggestions.
- **Search index:** built at build time over name, other names (OSM alt/official names, Wikidata aliases,
  Wikipedia title), park/forest/managing unit and state/province; gzipped, loaded on first search and kept in
  the browser's Cache Storage per snapshot. Matching is word-prefix and typo-tolerant (edit distance 1–2); a
  query naming a park ranks that park's trails by quality.

- **Worldwide search.** The main search index holds every U.S./Canada trail plus the 250,000 best worldwide trails
  (route relations first, then by quality score). Each country also has its own index; a query that names a
  country or one of its regions ("Adlerweg Tirol", "trails in Norway") loads that country's index too, so every
  worldwide trail is findable without a multi-hundred-MB download. Trail pages find a trail through a 256-file
  id lookup instead of the search index.

## Map

- **Basemaps (licences):** Topo = OpenFreeMap "liberty" vector tiles (free for any use, OpenMapTiles schema, ©
  OpenStreetMap contributors) with hillshading and contour lines generated in a web worker from AWS Terrain
  Tiles (`maplibre-contour`, MIT). Standard = the same OpenFreeMap map without terrain. Satellite = Esri World
  Imagery with Esri reference layers, shown with Esri's attribution; heavy commercial traffic may need an ArcGIS
  Location Platform key (free tier available). The OSM US tile server was dropped because its terms don't
  clearly cover a public consumer app.
- **Clusters:** zoomed out, count bubbles come from a build-time overview (counts per grid cell at six sizes,
  per section) so no full-catalog download is needed; from zoom 11 the app loads only the 2° cells in view and
  MapLibre clusters those pins in its worker.

## Hosting and size

- `public/trail-data`, the sitemaps and `robots.txt` are generated at build time from `data/trail-catalog`
  (`npm run build` runs `scripts/prepare-trail-assets.ts`), so only the source snapshot is committed. Output is
  sharded by 2° cell (trail records) and 1° cell (lines and hike features). Final sizes: see the summary below.
- `npm run build` = `prebuild` (map assets + `prepare-trail-assets.ts`) then the Vite build; `build:dev` is the same
  in development mode. `npm run build:server` builds the Next.js app (API routes and the server-rendered pages),
  which reads `data/trail-catalog` directly and serves its own sitemap and robots.txt.

- **Worldwide data files.** The snapshot keeps worldwide trails per country (`world/index-<country>.json.gz`) and
  their lines per 1° cell (`world/geometry-<cell>.json.gz`); `prepare-trail-assets.ts` reads one country at a
  time, writes cells per country (`cell-<x>_<y>-<country>.json.gz`) and merges lines into the shared geometry
  cells, so the build's memory doesn't grow with the number of countries.
- **Server bundle.** The Next.js server (`build:server`, Vercel) bundles only the current snapshot's own files
  (`next.config.ts`); worldwide files, the hike-feature layer and older snapshots are left out of its functions,
  which have a size limit. The server API therefore serves the U.S. and Canada; worldwide trails are served by
  the static web app's files. When `VITE_HYKED_API_URL` points the static app at that server, its trail catalog
  comes from the server and shows only the U.S. and Canada.

## Attribution

Each page credits the sources it shows: OpenStreetMap (ODbL) and the official agencies in the map's attribution
control, on trail pages, in the "Along the trail" list and in the route builder; the basemap providers
(OpenFreeMap/OpenMapTiles, Esri imagery, AWS Terrain Tiles for hillshade and contours) on the map; Wikimedia author
and licence on every photo; Wikipedia (CC BY-SA) under descriptions; GeoNames under towns; the National Weather
Service or Open-Meteo under forecasts; OSRM/FOSSGIS when road connectors are used. `/about/data` lists every source
with its licence and is linked from the "More" menu and the map attribution.

## Route builder

- **Engine: in the browser.** Routes are computed client-side (`src/lib/routing`) over the full-resolution trail
  lines of the area around the start and end (`/api/trail-catalog/network`, at most a ~3° box). That covers day
  hikes and multi-day routes like Happy Isles → Tuolumne Meadows with no server, no hosting cost and nothing to
  keep in sync with the catalog. Very long routes (hundreds of miles) would need a self-hosted Valhalla or OSRM
  with a foot profile built from the same trail network: a small VM (~$10–20/month) refreshed with the monthly
  pipeline. Not set up, since it costs money.
- **Topology, no invented connectors.** Trails connect where they share a vertex; vertices within 10 m are merged
  and a line end within 25 m of another line is joined to it (mapping gaps). Crossing lines are split at the
  crossing. Nothing is drawn across open terrain: separate networks give "No trail connection".
- **Cost:** length × a quality factor, so verified and higher-scoring trails win over parallel mapped paths.
- **Road connectors** are off by default. When turned on, gaps between networks are bridged with one walking
  route from OSRM's foot profile (`/api/directions?profile=foot`, FOSSGIS public server or `ROUTING_FOOT_API_URL`),
  which follows real roads and paths. The static build without `VITE_HYKED_API_URL` has no routing server.
- **Facts on a route** come from the same sources as trail pages: DEM elevation, Naismith time, and hike features
  from the feature layer within 200 m (water) or 300 m (everything else) by mile. Day splits end at the campsite,
  shelter or hut nearest each day's mileage target. Saved routes become private personal trails in the account
  (share link optional) and feed "Plan a trip"; GPX export has a waypoint for every feature.

## Rendering

The app is a client-rendered single-page app (Vite + React Router); the Next.js app in `src/app` is kept for
its API routes and as an alternative server-rendered front end. Trail pages set a unique `<title>`, meta
description and schema.org JSON-LD in the browser, which Google and Bing index because they render
JavaScript; other crawlers and link previews see the generic tags from `index.html`.

- **Prerendering** (static HTML per trail at build time, e.g. a small Vite plugin writing
  `/explore/trails/<id>/index.html` with the title, description and JSON-LD) would give every crawler and link
  preview the right tags with no server, but ~450,000 pages adds build time and hundreds of MB of output;
  prerendering only the top few thousand trails by quality score is a reasonable middle ground.
- **Server rendering** (serving trail pages from the existing Next.js app, which already reads the same
  snapshot) gives complete HTML for every page without a huge build, at the cost of running a server.

## Lovable

The app is deployed from git, not Lovable. Lovable's badge and its `/~flock.js` and `/__l5e/` scripts are injected
by Lovable's hosting (they are not in this repository), so they disappear when the app is served from another
host. The Lovable-only preview-auth module (`src/integrations/supabase`) and `bun.lock` were removed, and the
"Local preview · Account sign-in and cloud sync are not connected" footer was deleted.

## Backend and accounts

**Supabase** (already the project's backend; free tier is enough to start) holds everything a person creates.
The browser is only a thin cache: nothing a person makes is written to the device.

| data | table | before |
|---|---|---|
| Gear | `gear_items` | account (signed in) / localStorage (guests, planner additions) |
| Trip-planner preferences | `user_preferences.planner_profile` | localStorage |
| Saved trips (request, route, pack, shopping list, packed items, feedback) | `trips` | localStorage |
| Routes joined on the map (earlier versions; the route builder now saves personal trails) | `saved_routes` | localStorage (`hyked-connected-route`, migrated on sign-in) |
| Personal trails (route builder: geometry, stats, features, days, photo) | `personal_trails` + private `trail-photos` bucket | — (new) |
| Recorded activities | `activities` | account |
| Eco AI chat history | `ai_chat_messages` | not kept |

- **Row-level security** on every table: a row is readable and writable only by its owner (`auth.uid() = user_id`).
  A personal trail is visible to anyone else only when its owner turns sharing on; then it is read through
  `get_shared_personal_trail(token)` with a random 64-character token (turning sharing off deletes the token).
  Photos live in `<user id>/…` folders of the private `trail-photos` bucket and are served by short-lived signed
  URLs; others can read a photo only while the trail using it is shared. Migration:
  `supabase/migrations/20261021000001_cloud_user_data.sql` (idempotent; also appended to `full-bootstrap.sql`).
- **Guests** can use everything. What they make is held in memory for the visit only, the sidebar says
  "Guest · not saved", and a one-time banner asks them to create an account. Signing in moves this visit's work into
  the account. Google sign-in leaves the page, so just before that redirect the guest's work is handed over through
  `sessionStorage` and deleted as soon as it reaches the account (a guest's trail photo can't make that trip; it is
  kept when signing in with email and password).
- **Migration of old device data:** on the first sign-in on a device, planner data that earlier versions kept in
  `localStorage` (`outdoor-os:planner:v1:<guest | user id>`) and the map's last joined route are copied into the
  account and then removed from the device. Other accounts' keys on a shared device are left for those accounts.
- **Sync status** in the sidebar: "Synced · just now", "Syncing…", "Offline — changes will sync" (writes that fail
  for lack of a connection are retried when it returns, while the tab is open) or "Sync problem".
- **What still uses the device:** the Supabase sign-in session (a cookie), small one-visit flags (the dismissed
  save banner, the Google sign-in handoff), the cached search index (Cache Storage, rebuilt from the server), and
  the Eco AI model itself (~2 GB of model files the browser caches so the model can run on the device; that is the
  point of an on-device model and contains no personal data).
- **Sign-in:** email + password (with the email-confirmation link returning to `/auth/callback`) and Google OAuth.
  Both the static app and the Next.js app handle `/auth/callback`.

### Hosting setup (one time, in the Supabase and hosting dashboards)

1. Create a Supabase project (free tier). Run the migrations: `npx supabase link --project-ref <ref>` then
   `npx supabase db push`, or paste `supabase/full-bootstrap.sql` followed by the later files in
   `supabase/migrations/` into Dashboard → SQL Editor.
2. Authentication → URL Configuration: Site URL = the live site (e.g. `https://hyked.lovable.app`); add
   `https://<site>/auth/callback` (and `http://localhost:8080/auth/callback` for development) to Redirect URLs.
3. Authentication → Providers → Google: enable it with a Google Cloud OAuth client (free); in Google Cloud add
   `https://<project-ref>.supabase.co/auth/v1/callback` as an authorized redirect URI.
4. Storage: the migration creates the private `trail-photos` bucket; nothing else to do.
5. Hosting environment variables (public values only; never put the service-role key in the client):
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the static app (or `NEXT_PUBLIC_SUPABASE_URL` /
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which both apps read). `SUPABASE_SERVICE_ROLE_KEY` is only for server-side
   ingestion scripts and must stay out of the static build.
