#!/usr/bin/env python3
"""
OpenStreetMap route relations (hiking, foot, bicycle, mtb, horse, ski) from Geofabrik extracts of every U.S. state
and Canadian province/territory. Each extract is downloaded to a RAM-backed scratch folder (a macOS RAM disk the script creates, or /dev/shm on
Linux), read with pyosmium, reduced to the route relations, their member ways and named trail ways, and deleted:
the raw extracts never touch the computer's disk. Only the small result is kept. (pyosmium reads in-memory
buffers far more slowly than files, so a RAM disk is used rather than a Python bytes buffer.)

Output: .cache/osm-pbf/<region>.json.gz  {"relations": {id: {"tags", "members"}}, "ways": {id: [[lon, lat], ...]}}
Then `npx tsx scripts/ingestion/osm-routes.ts --pbf` joins the regions into data/sources/osm-routes.json.gz.

Usage: python3 scripts/ingestion/osm-routes-pbf.py [--workers 4]
Data © OpenStreetMap contributors, ODbL 1.0. Extracts from download.geofabrik.de.
"""
import concurrent.futures
import gzip
import json
import os
import subprocess
import sys
import time

import osmium

ROOT = os.getcwd()
OUT = os.path.join(ROOT, ".cache/osm-pbf")
ROUTES = {"hiking", "foot", "bicycle", "mtb", "horse", "ski"}
# Named ways of these types are trail candidates (the verification filter decides which become trails).
TRAIL_HIGHWAYS = {"path", "footway", "track", "bridleway", "cycleway"}
# Tags the verification filter and the trail record need; everything else is dropped to keep files small.
KEEP_TAGS = {"name", "alt_name", "official_name", "ref", "highway", "surface", "sac_scale", "access", "foot", "bicycle", "horse",
             "motor_vehicle", "motorcar", "footway", "informal", "indoor", "level", "location", "tunnel", "covered", "area",
             "service", "golf", "mtb:scale", "mtb:scale:imba", "operator", "trail_visibility", "climbing", "website", "wikidata",
             "description", "width", "smoothness", "lit", "seasonal", "disused", "abandoned", "construction", "highway:disused"}
US = ["alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "district-of-columbia", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new-hampshire", "new-jersey", "new-mexico", "new-york", "north-carolina", "north-dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode-island", "south-carolina", "south-dakota", "tennessee", "texas", "utah", "vermont", "virginia", "washington", "west-virginia", "wisconsin", "wyoming"]
CANADA = ["alberta", "british-columbia", "manitoba", "new-brunswick", "newfoundland-and-labrador", "northwest-territories", "nova-scotia", "nunavut", "ontario", "prince-edward-island", "quebec", "saskatchewan", "yukon"]
REGIONS = [("us", r) for r in US] + [("canada", r) for r in CANADA]


def extract(pbf) -> dict:
    """Route relations and their member ways' coordinates from one extract (two passes)."""
    relations, way_ids = {}, set()
    route_filter = osmium.filter.TagFilter(*[("route", v) for v in ROUTES])
    for rel in osmium.FileProcessor(pbf, osmium.osm.RELATION).with_filter(route_filter):
        tags = {t.k: t.v for t in rel.tags}
        if tags.get("type") not in ("route", "superroute"):
            continue
        members = [[m.type, m.ref, m.role] for m in rel.members]
        relations[rel.id] = {"tags": tags, "members": members}
        way_ids.update(ref for typ, ref, _ in members if typ == "w")
    # One pass over ways with node locations: every relation member way, plus every named trail-type way.
    ways, trails = {}, {}
    processor = osmium.FileProcessor(pbf, osmium.osm.NODE | osmium.osm.WAY).with_locations().with_filter(osmium.filter.KeyFilter("highway").enable_for(osmium.osm.WAY)).with_filter(osmium.filter.EntityFilter(osmium.osm.WAY))
    for way in processor:
        member = way.id in way_ids
        tags = way.tags
        candidate = tags.get("highway") in TRAIL_HIGHWAYS and ("name" in tags or "official_name" in tags or "ref" in tags)
        if not member and not candidate:
            continue
        coords = []
        for n in way.nodes:
            if n.location.valid():
                coords.append([round(n.location.lon, 5), round(n.location.lat, 5)])
        if len(coords) < 2:
            continue
        ways[way.id] = coords
        if candidate:
            trails[way.id] = {t.k: t.v for t in tags if t.k in KEEP_TAGS}
    return {"relations": relations, "ways": ways, "trails": trails}


RAM = {"dir": None, "device": None}


def scratch() -> str:
    """A folder backed by memory, created once per run."""
    if RAM["dir"]:
        return RAM["dir"]
    if os.path.isdir("/dev/shm"):
        RAM["dir"] = "/dev/shm/hyked-osm"
    elif sys.platform == "darwin":
        if not os.path.isdir("/Volumes/hyked-ram"):
            device = subprocess.run(["hdiutil", "attach", "-nomount", f"ram://{6 * 1024 * 2048}"], capture_output=True, text=True, check=True).stdout.strip()
            subprocess.run(["diskutil", "erasevolume", "APFS", "hyked-ram", device], capture_output=True, check=True)
            RAM["device"] = device
        RAM["dir"] = "/Volumes/hyked-ram"
    else:
        raise SystemExit("No RAM-backed folder available (need /dev/shm or macOS).")
    os.makedirs(RAM["dir"], exist_ok=True)
    return RAM["dir"]


def run(region: tuple) -> str:
    country, name = region
    target = os.path.join(OUT, f"{name}.json.gz")
    if os.path.exists(target):
        return f"{name}: cached"
    pbf = os.path.join(scratch(), f"{name}.osm.pbf")
    url = f"https://download.geofabrik.de/north-america/{country}/{name}-latest.osm.pbf"
    started = time.time()
    try:
        for attempt in range(3):
            result = subprocess.run(["curl", "-sSfL", "--retry", "3", "-A", "Hyked/1.0 trail catalog (https://github.com/tackleguy/health)", "-o", pbf, url], capture_output=True, text=True)
            if result.returncode == 0:
                break
            time.sleep(10 * (attempt + 1))
        else:
            return f"{name}: download failed ({result.stderr.strip()[:120]})"
        size = os.path.getsize(pbf) / 1e6
        # Parse in a child process so each extract's node index is freed when it finishes.
        parsed = subprocess.run([sys.executable, __file__, "--parse", pbf, target], capture_output=True, text=True)
        if parsed.returncode != 0:
            return f"{name}: parse failed ({parsed.stderr.strip()[-200:]})"
        return f"{name}: {size:.0f} MB in {time.time() - started:.0f}s — {parsed.stdout.strip()}"
    finally:
        if os.path.exists(pbf):
            os.remove(pbf)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--parse":
        _, _, pbf, target = sys.argv
        data = extract(pbf)
        with gzip.open(target + ".tmp", "wt") as f:
            json.dump(data, f, separators=(",", ":"))
        os.replace(target + ".tmp", target)
        print(f"{len(data['relations'])} relations, {len(data['trails'])} named trail ways, {len(data['ways'])} ways")
        return
    workers = int(sys.argv[sys.argv.index("--workers") + 1]) if "--workers" in sys.argv else 3
    os.makedirs(OUT, exist_ok=True)
    # Largest first, so the long downloads overlap with everything else.
    order = sorted(REGIONS, key=lambda r: r[1] not in ("california", "ontario", "quebec", "british-columbia", "texas", "new-york", "florida", "pennsylvania"))
    scratch()
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            for line in pool.map(run, order):
                print(line, flush=True)
    finally:
        if RAM["device"]:
            subprocess.run(["hdiutil", "detach", RAM["device"]], capture_output=True)
    print("done", flush=True)


if __name__ == "__main__":
    main()
