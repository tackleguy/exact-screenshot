# Hyked trail data pipeline

One command rebuilds the trail catalog from public sources. It is safe to re-run monthly; every step caches its
inputs under `.cache/`, so an interrupted run resumes where it stopped.

```bash
npm run pipeline                  # OSM extracts (cached regions skipped) → Wikidata → build → features → validation report
npm run pipeline -- --refresh     # re-download every OSM region and refresh Wikidata
npm run pipeline -- --official    # also rebuild the official-agency layer (slow; cached ArcGIS pages reused)
npm run pipeline -- --world       # also add every other country (planet stream, ~3 h, ~25 GB free disk)
npm run pipeline -- --mirror openstreetmap.fr --disk
                                  # U.S./Canada extracts from the OSM France mirror, downloads and node index on disk
npm run build                     # turns the snapshot into the app's sharded files, sitemap and robots.txt
```

In a cloud container that can't reach Geofabrik, the full worldwide run is
`npm run pipeline -- --mirror openstreetmap.fr --disk --world` (osmium-tool must be installed:
`apt-get install osmium-tool`; Python needs `pip install --user osmium numpy pyshp shapely`).

Requirements: Node 20+, Python 3.9+ with `pip install --user osmium` (pyosmium 4), `curl`, ~16 GB RAM, ~2 GB free
disk. A full run takes roughly an hour (most of it downloading the OSM extracts).

## Steps

| step | file | output |
|---|---|---|
| 1. Official layers (`--official`) | `scripts/ingestion/source-catalog.ts`, `trail-uses.ts`, `reclassify-winter.ts` | an official snapshot in `data/trail-catalog/`; `official-base.json` points at it |
| 2. OpenStreetMap | `pipeline/steps/extract-osm.py` | `.cache/osm-pbf/<region>.json.gz` (trails) and `.cache/osm-features/<region>.json.gz` (hike features) per U.S. state / Canadian province |
| 3. Wikidata / Wikipedia | `pipeline/steps/wiki.ts` | `data/sources/wiki-trails.json.gz` |
| 4. Build | `pipeline/steps/build.ts` | a new `data/trail-catalog/snapshot-<time>/` (the previous one is kept) and `current.json` |
| 4a. Outlines (`--world`) | `pipeline/steps/places.py` | `.cache/world-work/countries.json`, `data/sources/world-admin1.json.gz` (Natural Earth) |
| 4b. Planet (`--world`) | `pipeline/steps/extract-world.py` | `.cache/world-pbf/<country>.json.gz` and `.cache/world-features/<country>.json.gz` |
| 4c. Wikidata worldwide (`--world`) | `pipeline/steps/wiki.ts --world` | `data/sources/wiki-world.json.gz` |
| 4d. Worldwide build (`--world`) | `pipeline/steps/world.ts` | `world/index-<country>.json.gz`, `world/geometry-<cell>.json.gz`, `world/report.json` in the snapshot |
| 4e. Sections | `pipeline/steps/sections.ts` | routes list their stages (`sections`), stages link to their route (`partOfRoute`), from OSM route relations that contain other routes |
| 5. Hike features | `pipeline/steps/features.ts` | `features/f-<cell>.json.gz` in the snapshot: every feature with its mile on each nearby trail, plus `features-report.json` |
| 6. Validation report | `pipeline/steps/validate.ts` | printed; the build also writes `build-report.json` in the snapshot |
| 7. App files (`npm run build`) | `scripts/prepare-trail-assets.ts` | `public/trail-data/…` (worldwide trails read one country at a time: cells per country, a search index per country, id lookup in 256 files), `public/sitemap.xml`, `public/sitemaps/*.xml`, `public/robots.txt` (generated, not committed) |

### 1. Official layers
USGS National Digital Trails (which already compiles many state and local layers: Colorado COTREX via Colorado
Parks and Wildlife, California State Parks, Utah AGRC, Washington State Parks, …), the NPS Public Trails feature
service, the USFS EDW National Forest System Trails, BLM Ground Transportation Linear Features, Parks Canada and
the Ontario Trail Network. Kept per record: name, official ID/number, allowed uses, surface, length, managing unit
and the source link. Endpoints are listed in `scripts/ingestion/source-catalog.ts`.

### 2. OpenStreetMap
Each Geofabrik extract is downloaded into a RAM disk (a macOS RAM volume the script creates, or `/dev/shm` on
Linux), read with pyosmium and deleted, so the raw extract is never written to the computer's disk.
Kept: every route relation with `route=hiking|foot|bicycle|mtb|horse|ski` and its member ways, and every
`highway=path|footway|track|bridleway|cycleway` way with a name, with the tags the verification rules need.

A second pass over the same extract keeps hike features within 300 m of those trail ways: springs, drinking
water, campsites, shelters, huts, trailheads, parking, toilets, viewpoints, peaks, passes, fords, waterfalls,
picnic sites and ranger stations, plus computed stream crossings, bridges, and nearby named lakes and rivers.

Route relations of every non-motorized type are kept: hiking, foot, walking, running, fitness_trail, bicycle, mtb,
horse, ski, piste (ski, sled and snowshoe pistes), canoe (water trails) and inline_skates. Named pistes
(`piste:type`) are trail candidates too, even without a `highway` tag.

With `--mirror openstreetmap.fr` the U.S. comes from the mirror's four regional extracts (west, south, midwest,
northeast) and Canada from its provinces; the mirror has no Alaska or Hawaii extract, so those two states come from
the worldwide step. `--disk` downloads each extract over several connections (`pipeline/steps/fetch.py`, resumable)
and keeps pyosmium's node index in a file, so a 5 GB regional extract fits in 16 GB of memory; one region is
parsed while the next downloads. Region files are JSON lines (`relations`, `trails` and `ways` in chunks of
200,000), so no single JSON string is too long for Node to parse.

### 2b. The rest of the world (`--world`)
The planet file (~95 GB, AWS Open Data mirror) is never stored. It is streamed three times over parallel range
requests and filtered on the fly: (1) route relations, the ids of named trail ways and pistes, and hike-feature
nodes; (2) the ways those relations use plus the named ways; (3) the nodes of all those ways. The pieces are merged
into a "trails planet" of a few GB, its nodes renumbered (osmium extract sizes its id sets by the largest id), and
split into one file per country with `osmium extract` (Natural Earth outlines widened by ~3 km; route relations kept
whole, so a trail that crosses a border is complete in each country's file), 15 countries per pass. Each country
file then goes through the same parse and feature passes as the U.S. and Canada.

`world.ts` builds every country with the same rules (`osm-trails.ts` is shared with `build.ts`): relations →
verified, joined named ways → mapped after R1–R10, a named way that is the same trail as a relation becomes its
source, same-name duplicates merge. A trail is built once, by the country holding its map pin; country and region
come from Natural Earth admin-1 outlines. Items a relation links with its `wikidata` tag add the English Wikipedia
lead paragraph and a licensed Commons photo.

### 3. Wikidata
Trails in the U.S. and Canada (instances of trail, Q628179, and subclasses) plus items OSM relations link with a
`wikidata` tag: names, aliases, coordinates, the English Wikipedia lead paragraph and the item's main Commons
image with its licence and author.

### 4. Build
- Relations become trails ("verified"): member ways chained in order, alternatives/approaches left out.
- Official records ("verified") are matched to relations: same name and ≥50% of the line within 100 m → one
  record that keeps the official name (and length when one record covers the relation) and lists every
  contributor in `sources`.
- Named OSM ways are joined with same-name ways that touch within 25 m, then pass the verification filter
  (rules R1–R10, `RULES` in `build.ts`, documented in `DECISIONS.md`). A way that is the same trail as a verified
  record becomes one of its sources; the rest become "mapped" trails.
- Trails inside a National Park Service unit get the park name; Wikidata items are matched by relation, by
  `wikidata` tag, or by name within 20 km; curated guides get their real lines; every trail gets a quality score.

### 5. Hike features
Worldwide trails get the same pass from `.cache/world-features/<country>.json.gz`, one country at a time.

`features.ts` reads every region's feature file, removes duplicates where extracts overlap at borders, and walks
each shown trail's line in the same order trail pages use (`chainLines`) to record every feature within 300 m
(lakes and rivers 200 m, fords 60 m, crossings and bridges 40 m) with its mile marker and distance off the trail. Features
near no shown trail are dropped. Output is sharded by 1° cell; `features-report.json` has the counts by type.

### 6. Validation report
`validate.ts` prints totals by tier and source, rejections by rule (from `build-report.json`), hike features by
type, coverage percentages (named, relation, official match, line, Wikipedia, photo, trailhead), a DEM check of
summit elevations, and 10 random trails with their key fields.

### Running steps by hand
`python3 pipeline/steps/extract-osm.py --workers 6` (more workers download and parse more regions at once; a second
run with `--reverse` can share the list), then `npx tsx pipeline/steps/wiki.ts`,
`node --max-old-space-size=12288 node_modules/.bin/tsx pipeline/steps/build.ts` (`--dry-run` prints counts without
writing), `npx tsx pipeline/steps/features.ts`, `npx tsx pipeline/steps/validate.ts`, then `npm run build`.

## Licences
OpenStreetMap data © OpenStreetMap contributors (ODbL 1.0). U.S. federal data is public domain; Parks Canada and
Ontario data are under the Open Government Licence. Wikidata is CC0, Wikipedia text CC BY-SA 4.0, and each
Commons image carries its own licence and author, which the app shows. The app lists every source and licence at
`/about/data`.
