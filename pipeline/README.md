# Hyked trail data pipeline

One command rebuilds the trail catalog from public sources. It is safe to re-run monthly; every step caches its
inputs under `.cache/`, so an interrupted run resumes where it stopped.

```bash
npm run pipeline                  # OSM extracts (cached regions skipped) → Wikidata → build → features → validation report
npm run pipeline -- --refresh     # re-download every OSM region and refresh Wikidata
npm run pipeline -- --official    # also rebuild the official-agency layer (slow; cached ArcGIS pages reused)
npm run build                     # turns the snapshot into the app's sharded files, sitemap and robots.txt
```

Requirements: Node 20+, Python 3.9+ with `pip install --user osmium` (pyosmium 4), `curl`, ~16 GB RAM, ~2 GB free
disk. A full run takes roughly an hour (most of it downloading the OSM extracts).

## Steps

| step | file | output |
|---|---|---|
| 1. Official layers (`--official`) | `scripts/ingestion/source-catalog.ts`, `trail-uses.ts`, `reclassify-winter.ts` | an official snapshot in `data/trail-catalog/`; `official-base.json` points at it |
| 2. OpenStreetMap | `pipeline/steps/extract-osm.py` | `.cache/osm-pbf/<region>.json.gz` (trails) and `.cache/osm-features/<region>.json.gz` (hike features) per U.S. state / Canadian province |
| 3. Wikidata / Wikipedia | `pipeline/steps/wiki.ts` | `data/sources/wiki-trails.json.gz` |
| 4. Build | `pipeline/steps/build.ts` | a new `data/trail-catalog/snapshot-<time>/` (the previous one is kept) and `current.json` |
| 5. Hike features | `pipeline/steps/features.ts` | `features/f-<cell>.json.gz` in the snapshot: every feature with its mile on each nearby trail, plus `features-report.json` |
| 6. Validation report | `pipeline/steps/validate.ts` | printed; the build also writes `build-report.json` in the snapshot |
| 7. App files (`npm run build`) | `scripts/prepare-trail-assets.ts` | `public/trail-data/…`, `public/sitemap.xml`, `public/sitemaps/*.xml`, `public/robots.txt` (generated, not committed) |

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
