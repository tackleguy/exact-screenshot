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
| R10 | Outside the U.S. and Canada, in open water, or outside every state/province polygon (10 km tolerance for generalized coastlines) |

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

## Ranking and search

- **Quality score** (`src/lib/trail-catalog/score.ts`): verified +15, route relation +25, official source +20,
  Wikidata +15 (+10 with an article), trailhead +8, named +10, over 1 mi +8, national network +15, regional +8,
  local +3, inside a park or forest +10; climbers' approach/descent −25, unnamed or fragment −30, under 0.25 mi
  −10, a mapped trail that barely passed the filter −10. It orders search, map lists and near-you suggestions.
- **Search index:** built at build time over name, other names (OSM alt/official names, Wikidata aliases,
  Wikipedia title), park/forest/managing unit and state/province; gzipped, loaded on first search and kept in
  the browser's Cache Storage per snapshot. Matching is word-prefix and typo-tolerant (edit distance 1–2); a
  query naming a park ranks that park's trails by quality.

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
  sharded by 2° cell (trail records) and 1° cell (lines). Final sizes: see the summary below.

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
"Local preview · Account sign-in and cloud sync are not connected" footer now shows only in development builds.
