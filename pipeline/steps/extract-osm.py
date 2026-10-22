#!/usr/bin/env python3
"""
OpenStreetMap route relations (hiking, foot, bicycle, mtb, horse, ski) from Geofabrik extracts of every U.S. state
and Canadian province/territory. Each extract is downloaded to a RAM-backed scratch folder (a macOS RAM disk the script creates, or /dev/shm on
Linux), read with pyosmium, reduced to the route relations, their member ways and named trail ways, and deleted:
the raw extracts never touch the computer's disk. Only the small result is kept. (pyosmium reads in-memory
buffers far more slowly than files, so a RAM disk is used rather than a Python bytes buffer.)

Outputs per region:
  .cache/osm-pbf/<region>.json.gz       {"relations": {id: {"tags", "members"}}, "ways": {id: [[lon, lat], ...]}, "trails": {id: tags}}
  .cache/osm-features/<region>.json.gz  {"features": [[type, name, lon, lat, extra], ...]}  hike features on or near trails
The feature pass reads the region's trail ways from the first output, so it keeps only features within 300 m of a
trail (water bodies within 200 m) and computes where streams and rivers cross trail lines.

Usage: python3 pipeline/steps/extract-osm.py [--workers 3] [--mirror openstreetmap.fr] [--disk]
  --mirror openstreetmap.fr   download from the OSM France mirror (U.S. regional extracts, Canadian provinces)
  --disk                      keep downloads and the node index on disk (for machines without much memory);
                              one region is parsed at a time while the next one downloads
Data © OpenStreetMap contributors, ODbL 1.0. Extracts from download.geofabrik.de or download.openstreetmap.fr.
"""
from __future__ import annotations

import concurrent.futures
import gzip
import json
import math
import os
import subprocess
import sys
import time

import numpy as np
import osmium

ROOT = os.getcwd()
OUT = os.path.join(ROOT, ".cache/osm-pbf")
# Every non-motorized route type: foot, bike, horse, ski and sled pistes, running, fitness and paddling routes.
ROUTES = {"hiking", "foot", "walking", "running", "fitness_trail", "bicycle", "mtb", "horse", "ski", "piste", "canoe", "inline_skates"}
# Named ways of these types are trail candidates (the verification filter decides which become trails).
TRAIL_HIGHWAYS = {"path", "footway", "track", "bridleway", "cycleway"}
# Tags the verification filter and the trail record need; everything else is dropped to keep files small.
KEEP_TAGS = {"name", "alt_name", "official_name", "ref", "highway", "surface", "sac_scale", "access", "foot", "bicycle", "horse",
             "motor_vehicle", "motorcar", "footway", "informal", "indoor", "level", "location", "tunnel", "covered", "area",
             "service", "golf", "mtb:scale", "mtb:scale:imba", "operator", "trail_visibility", "climbing", "website", "wikidata",
             "description", "width", "smoothness", "lit", "seasonal", "disused", "abandoned", "construction", "highway:disused",
             "piste:type", "piste:difficulty", "piste:grooming", "piste:name", "sport"}
US = ["alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "district-of-columbia", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new-hampshire", "new-jersey", "new-mexico", "new-york", "north-carolina", "north-dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode-island", "south-carolina", "south-dakota", "tennessee", "texas", "utah", "vermont", "virginia", "washington", "west-virginia", "wisconsin", "wyoming"]
CANADA = ["alberta", "british-columbia", "manitoba", "new-brunswick", "newfoundland-and-labrador", "northwest-territories", "nova-scotia", "nunavut", "ontario", "prince-edward-island", "quebec", "saskatchewan", "yukon"]
REGIONS = [("us", r) for r in US] + [("canada", r) for r in CANADA]
# download.openstreetmap.fr (the OSM France mirror) publishes the U.S. in four regional extracts plus a few states,
# and every Canadian province. Used with --mirror openstreetmap.fr where Geofabrik can't be reached. It has no
# Alaska or Hawaii extract; those states keep their official-agency trails.
OSMFR = "https://download.openstreetmap.fr/extracts/north-america"
OSMFR_REGIONS = [(f"{OSMFR}/{r}-latest.osm.pbf", r) for r in ("us-west", "us-south", "us-midwest", "us-northeast")] + \
    [(f"{OSMFR}/canada/{r.replace('-', '_')}-latest.osm.pbf", r) for r in CANADA]


def region_url(region: tuple) -> str:
    country, name = region
    return country if country.startswith("https://") else f"https://download.geofabrik.de/north-america/{country}/{name}-latest.osm.pbf"


# Node-location index for pyosmium. "flex_mem" keeps it in memory; --disk switches to a file-backed sparse index
# so a multi-gigabyte regional extract fits on a machine with less memory.
INDEX = {"storage": "flex_mem"}


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
    processor = osmium.FileProcessor(pbf, osmium.osm.NODE | osmium.osm.WAY).with_locations(INDEX["storage"]).with_filter(osmium.filter.KeyFilter("highway", "piste:type").enable_for(osmium.osm.WAY)).with_filter(osmium.filter.EntityFilter(osmium.osm.WAY))
    for way in processor:
        member = way.id in way_ids
        tags = way.tags
        # Named trail-type ways, and named ski, sled and snowshoe pistes (which often have no highway tag).
        candidate = (tags.get("highway") in TRAIL_HIGHWAYS or "piste:type" in tags) and ("name" in tags or "official_name" in tags or "ref" in tags or "piste:name" in tags)
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


FEATURES = os.path.join(ROOT, ".cache/osm-features")
NEAR_M, WATER_M, CELL = 300, 200, 0.01  # feature distance limits; trail-segment grid (~1 km)


def feature_type(tags) -> str | None:
    """The hike-feature type of an OSM element, or None."""
    natural, amenity, tourism = tags.get("natural"), tags.get("amenity"), tags.get("tourism")
    if natural == "spring": return "spring"
    if amenity in ("drinking_water", "water_point") or tags.get("man_made") == "water_tap" or tags.get("drinking_water") == "yes" and amenity == "fountain": return "drinking_water"
    if tourism == "camp_site": return "campsite"
    if tourism == "camp_pitch": return "camp_pitch"
    if tourism in ("wilderness_hut", "alpine_hut"): return "hut"
    if amenity == "shelter": return "shelter"
    if tags.get("highway") == "trailhead": return "trailhead"
    if amenity == "parking" and tags.get("access") not in ("private", "no", "customers"): return "parking"
    if amenity == "toilets": return "toilets"
    if tourism == "viewpoint": return "viewpoint"
    if natural in ("peak", "volcano"): return "peak"
    if tags.get("mountain_pass") == "yes" or natural == "saddle": return "pass"
    if tags.get("ford") in ("yes", "stepping_stones"): return "ford"
    if tourism == "picnic_site" or tags.get("leisure") == "picnic_site": return "picnic_site"
    if amenity == "ranger_station": return "ranger_station"
    if tags.get("waterway") == "waterfall" or natural == "waterfall": return "waterfall"
    return None


class TrailGrid:
    """Trail segments of one region in a lon/lat grid, for nearness and crossing tests (planar metres).

    Segments are held in numpy arrays sorted by grid cell (a regional extract has tens of millions of them), with
    a set of the occupied cells so empty cells are skipped without touching the arrays."""

    def __init__(self, ways):
        """`ways`: an iterable of coordinate lists."""
        parts = []
        for coords in ways:
            if len(coords) > 1:
                a = np.asarray(coords, dtype=np.float64)
                parts.append(np.hstack([a[:-1], a[1:]]))
        segs = np.vstack(parts) if parts else np.zeros((0, 4))
        x0 = np.floor(np.minimum(segs[:, 0], segs[:, 2]) / CELL).astype(np.int64)
        x1 = np.floor(np.maximum(segs[:, 0], segs[:, 2]) / CELL).astype(np.int64)
        y0 = np.floor(np.minimum(segs[:, 1], segs[:, 3]) / CELL).astype(np.int64)
        y1 = np.floor(np.maximum(segs[:, 1], segs[:, 3]) / CELL).astype(np.int64)
        w, h = x1 - x0 + 1, y1 - y0 + 1
        counts = w * h
        idx = np.repeat(np.arange(len(segs)), counts)
        local = np.arange(len(idx)) - np.repeat(np.cumsum(counts) - counts, counts)
        keys = _cell_key(x0[idx] + local % w[idx], y0[idx] + local // w[idx])
        order = np.argsort(keys, kind="stable")
        self.keys, self.idx, self.segs = keys[order], idx[order], segs
        self.occupied = set(np.unique(self.keys).tolist())

    @staticmethod
    def _cells(a, b, pad=0.0):
        x0, x1 = sorted((a[0], b[0])); y0, y1 = sorted((a[1], b[1]))
        return [_cell_key(x, y) for x in range(int((x0 - pad) // CELL), int((x1 + pad) // CELL) + 1) for y in range(int((y0 - pad) // CELL), int((y1 + pad) // CELL) + 1)]

    def _segments(self, cells):
        found = [c for c in cells if c in self.occupied]
        if not found:
            return None
        picks = [self.idx[np.searchsorted(self.keys, c, "left"):np.searchsorted(self.keys, c, "right")] for c in found]
        return self.segs[np.unique(np.concatenate(picks))]

    def near(self, p, metres) -> float | None:
        """Distance from p to the nearest trail segment, if within `metres`."""
        segs = self._segments(self._cells(p, p, metres / 111_000 * 1.6))
        if segs is None:
            return None
        k = math.cos(math.radians(p[1])) * 111_320
        ax, ay = (segs[:, 0] - p[0]) * k, (segs[:, 1] - p[1]) * 110_540
        bx, by = (segs[:, 2] - p[0]) * k, (segs[:, 3] - p[1]) * 110_540
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy
        t = np.where(l2 > 0, np.clip(-(ax * dx + ay * dy) / np.where(l2 > 0, l2, 1), 0.0, 1.0), 0.0)
        d = float(np.min(np.hypot(ax + t * dx, ay + t * dy)))
        return d if d <= metres else None

    def crossings(self, coords):
        """Points where a waterway line crosses a trail segment."""
        out = []
        for c, d in zip(coords, coords[1:]):
            segs = self._segments(self._cells(c, d))
            if segs is None:
                continue
            for a0, a1, b0, b1 in segs.tolist():
                hit = _intersect((a0, a1), (b0, b1), c, d)
                if hit:
                    out.append(hit)
        return out


def _cell_key(x, y):
    return (x + 40_000) * 100_000 + (y + 20_000)


def _intersect(a, b, c, d):
    r = (b[0] - a[0], b[1] - a[1]); s = (d[0] - c[0], d[1] - c[1])
    den = r[0] * s[1] - r[1] * s[0]
    if den == 0:
        return None
    t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den
    u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den
    if 0 <= t <= 1 and 0 <= u <= 1:
        return [round(a[0] + t * r[0], 5), round(a[1] + t * r[1], 5)]
    return None


def features(pbf, trail_cache) -> dict:
    """Hike features on or near the region's trails: POIs, waterway crossings, nearby lakes and rivers, bridges."""
    grid = TrailGrid(region_ways(trail_cache))
    out, seen = [], set()

    def add(kind, name, p, extra=None):
        key = (kind, name, round(p[0], 3), round(p[1], 3))
        if key in seen:
            return
        seen.add(key)
        out.append([kind, name or "", p[0], p[1], extra or {}])

    def extra_of(tags):
        e = {}
        if tags.get("ele"):
            try: e["ele"] = round(float(tags["ele"].split(";")[0].replace("m", "").strip()))
            except ValueError: pass
        for k in ("drinking_water", "fee", "reservation", "backcountry", "capacity", "seasonal", "operator", "website"):
            if tags.get(k): e[k] = tags[k][:120]
        return e

    keys = osmium.filter.KeyFilter("natural", "amenity", "tourism", "highway", "mountain_pass", "ford", "waterway", "leisure", "man_made", "water")
    for obj in osmium.FileProcessor(pbf, osmium.osm.NODE | osmium.osm.WAY).with_locations(INDEX["storage"]).with_filter(keys):
        tags = obj.tags
        if obj.is_node():
            kind = feature_type(tags)
            if kind and obj.location.valid():
                p = [round(obj.location.lon, 5), round(obj.location.lat, 5)]
                if grid.near(p, NEAR_M) is not None:
                    add(kind, tags.get("name"), p, extra_of(tags))
            continue
        coords = [[n.location.lon, n.location.lat] for n in obj.nodes if n.location.valid()]
        if len(coords) < 2:
            continue
        waterway, highway = tags.get("waterway"), tags.get("highway")
        if waterway in ("stream", "river", "canal", "brook"):
            for p in grid.crossings(coords):
                add("crossing", tags.get("name"), p, {"waterway": waterway, **({"intermittent": True} if tags.get("intermittent") == "yes" else {})})
            if waterway == "river" and tags.get("name"):
                near = min(coords[:: max(1, len(coords) // 200)], key=lambda q: grid.near(q, WATER_M) or 1e9)
                if grid.near(near, WATER_M) is not None:
                    add("river", tags["name"], [round(near[0], 5), round(near[1], 5)])
            continue
        if highway in TRAIL_HIGHWAYS and tags.get("bridge") not in (None, "no"):
            mid = coords[len(coords) // 2]
            add("bridge", tags.get("name") or tags.get("bridge:name"), [round(mid[0], 5), round(mid[1], 5)])
            continue
        closed = coords[0] == coords[-1]
        if closed and tags.get("natural") == "water" and tags.get("water", "lake") in ("lake", "pond", "reservoir", "lagoon", "oxbow") and tags.get("name"):
            ring = coords[:: max(1, len(coords) // 300)]
            dists = [(grid.near(q, WATER_M), q) for q in ring]
            dists = [x for x in dists if x[0] is not None]
            if dists:
                q = min(dists)[1]
                add("lake", tags["name"], [round(q[0], 5), round(q[1], 5)])
            continue
        kind = feature_type(tags)
        if kind and closed:
            cx = sum(c[0] for c in coords[:-1]) / (len(coords) - 1); cy = sum(c[1] for c in coords[:-1]) / (len(coords) - 1)
            p = [round(cx, 5), round(cy, 5)]
            if grid.near(p, NEAR_M) is not None:
                add(kind, tags.get("name"), p, extra_of(tags))
    return {"features": out}


RAM = {"dir": None, "device": None, "disk": False}


def scratch() -> str:
    """A folder backed by memory, created once per run."""
    if RAM["dir"]:
        return RAM["dir"]
    if RAM["disk"]:
        RAM["dir"] = os.path.join(ROOT, ".cache/osm-download")
        os.makedirs(RAM["dir"], exist_ok=True)
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


def download(region: tuple) -> str:
    """Downloads one extract into the scratch folder (resumable, several connections); returns its path."""
    name = region[1]
    pbf = os.path.join(scratch(), f"{name}.osm.pbf")
    from fetch import fetch  # pipeline/steps/fetch.py
    fetch(region_url(region), pbf)
    return pbf


def done(region: tuple) -> bool:
    name = region[1]
    return os.path.exists(os.path.join(OUT, f"{name}.json.gz")) and os.path.exists(os.path.join(FEATURES, f"{name}.json.gz"))


def run(region: tuple, pbf_future=None) -> str:
    country, name = region
    target = os.path.join(OUT, f"{name}.json.gz")
    feature_target = os.path.join(FEATURES, f"{name}.json.gz")
    if done(region):
        return f"{name}: cached"
    started = time.time()
    pbf = None
    try:
        try:
            pbf = pbf_future.result() if pbf_future else download(region)
        except Exception as error:  # noqa: BLE001 — reported per region; the rest of the run continues
            return f"{name}: download failed ({str(error)[:160]})"
        size = os.path.getsize(pbf) / 1e6
        # Parse in a child process so each extract's node index is freed when it finishes.
        report = []
        index_args = ["--index", INDEX["storage"]]
        for mode, out in (("--parse", target), ("--features", feature_target)):
            if os.path.exists(out):
                continue
            clear_index()
            parsed = subprocess.run([sys.executable, __file__, mode, pbf, out, *index_args], capture_output=True, text=True)
            if parsed.returncode != 0:
                return f"{name}: {mode[2:]} failed ({parsed.stderr.strip()[-200:]})"
            report.append(parsed.stdout.strip())
        return f"{name}: {size:.0f} MB in {time.time() - started:.0f}s — {'; '.join(report)}"
    finally:
        if pbf and os.path.exists(pbf):
            os.remove(pbf)
        clear_index()


def clear_index():
    """Removes a file-backed node index, so each parse starts from an empty one."""
    if INDEX["storage"].startswith("sparse_file_array,"):
        path = INDEX["storage"].split(",", 1)[1]
        if os.path.exists(path):
            os.remove(path)


CHUNK = 200_000


def write_region(target: str, data: dict) -> None:
    """Writes a region as JSON lines, one object per line, each holding part of one of the three maps
    (`relations`, `trails`, `ways`), so no single line is too long for a JSON parser (V8 strings stop at ~512 MB)."""
    with gzip.open(target + ".tmp", "wt") as f:
        for key in ("relations", "trails", "ways"):
            items = list(data[key].items())
            for i in range(0, max(1, len(items)), CHUNK):
                json.dump({key: dict(items[i:i + CHUNK])}, f, separators=(",", ":"))
                f.write("\n")
    os.replace(target + ".tmp", target)


def read_region(path: str) -> dict:
    """Reads a region written by write_region (or an older single-object file)."""
    data = {"relations": {}, "trails": {}, "ways": {}}
    with gzip.open(path, "rt") as f:
        for line in f:
            if line.strip():
                for key, part in json.loads(line).items():
                    data[key].update(part)
    return data


def region_ways(path: str):
    """Coordinate lists of every way in a region file, read one chunk at a time."""
    with gzip.open(path, "rt") as f:
        for line in f:
            if line.strip():
                part = json.loads(line).get("ways")
                if part:
                    yield from part.values()


def main():
    if "--rewrite" in sys.argv:
        # Converts older single-object region files to the line format.
        for path in sys.argv[2:]:
            write_region(path, read_region(path))
        return
    if "--index" in sys.argv:
        INDEX["storage"] = sys.argv[sys.argv.index("--index") + 1]
    if len(sys.argv) > 1 and sys.argv[1] == "--parse":
        pbf, target = sys.argv[2:4]
        data = extract(pbf)
        write_region(target, data)
        print(f"{len(data['relations'])} relations, {len(data['trails'])} named trail ways, {len(data['ways'])} ways")
        return
    if len(sys.argv) > 1 and sys.argv[1] == "--features":
        pbf, target = sys.argv[2:4]
        data = features(pbf, os.environ.get("HYKED_TRAIL_CACHE") or os.path.join(OUT, os.path.basename(target)))
        with gzip.open(target + ".tmp", "wt") as f:
            json.dump(data, f, separators=(",", ":"))
        os.replace(target + ".tmp", target)
        counts = {}
        for row in data["features"]:
            counts[row[0]] = counts.get(row[0], 0) + 1
        print(f"{len(data['features'])} features ({', '.join(f'{k} {v}' for k, v in sorted(counts.items(), key=lambda kv: -kv[1])[:6])})")
        return
    workers = int(sys.argv[sys.argv.index("--workers") + 1]) if "--workers" in sys.argv else 3
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(FEATURES, exist_ok=True)
    mirror = "--mirror" in sys.argv and sys.argv[sys.argv.index("--mirror") + 1] == "openstreetmap.fr"
    RAM["disk"] = "--disk" in sys.argv
    if RAM["disk"]:
        INDEX["storage"] = f"sparse_file_array,{os.path.join(scratch(), 'nodes.idx')}"
    regions = OSMFR_REGIONS if mirror else REGIONS
    # Largest first, so the long downloads overlap with everything else.
    order = sorted(regions, key=lambda r: r[1] not in ("us-south", "us-west", "us-midwest", "us-northeast", "california", "ontario", "quebec", "british-columbia", "texas", "new-york", "florida", "pennsylvania"))
    # --reverse lets a second run work from the other end of the list at the same time (finished regions are skipped).
    if "--reverse" in sys.argv:
        order.reverse()
    order = [r for r in order if not done(r) or print(f"{r[1]}: cached", flush=True)]
    scratch()
    try:
        if RAM["disk"]:
            # One region is parsed at a time (the disk-backed index is shared); the next downloads meanwhile.
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as downloads:
                futures = {}
                for i, region in enumerate(order):
                    for ahead in order[i:i + 2]:
                        if ahead[1] not in futures:
                            futures[ahead[1]] = downloads.submit(download, ahead)
                    print(run(region, futures.pop(region[1])), flush=True)
        else:
            with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
                for line in pool.map(run, order):
                    print(line, flush=True)
    finally:
        if RAM["device"]:
            subprocess.run(["hdiutil", "detach", RAM["device"]], capture_output=True)
    print("done", flush=True)


if __name__ == "__main__":
    main()
