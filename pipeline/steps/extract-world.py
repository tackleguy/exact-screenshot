#!/usr/bin/env python3
"""
Worldwide OpenStreetMap trails without storing the planet file.

The planet (~95 GB) is streamed three times from a mirror (AWS Open Data, osm-pds) over several parallel
range requests, and filtered on the fly with osmium-tool and pyosmium. Only the objects trails need are kept:

  stream 1  route relations (every non-motorized route type), the ids of named trail-type ways and piste ways,
            and hike-feature nodes (springs, drinking water, campsites, huts, shelters, peaks, …)
  stream 2  the ways those relations use, plus the named trail ways
  stream 3  the nodes of all those ways

The pieces are merged into one "trails planet" file (a few GB), split into one file per country with
`osmium extract` (complete relations, so a trail that crosses a border is whole in each country's file), and every
country file goes through the same parse and feature passes as the U.S. and Canada (extract-osm.py), writing

  .cache/world-pbf/<country>.json.gz        route relations, member ways and named trail ways
  .cache/world-features/<country>.json.gz   hike features within 300 m of a trail

Each stage's output is kept, so an interrupted run resumes at the first unfinished stage.

Usage: python3 pipeline/steps/extract-world.py [--planet URL] [--connections 12]
Requires osmium-tool (`apt-get install osmium-tool`) and pyosmium. Needs ~25 GB free disk while running.
Data © OpenStreetMap contributors, ODbL 1.0.
"""
from __future__ import annotations

import concurrent.futures
import gzip
import json
import os
import shutil
import subprocess
import sys
import time

import numpy as np
import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch import AGENT, size_of  # noqa: E402

ROOT = os.getcwd()
WORK = os.path.join(ROOT, ".cache/world-work")
OUT = os.path.join(ROOT, ".cache/world-pbf")
FEATURES = os.path.join(ROOT, ".cache/world-features")
PLANET = "https://osm-pds.s3.amazonaws.com/planet-latest.osm.pbf"
EXTRACT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "extract-osm.py")
ROUTES = ["hiking", "foot", "walking", "running", "fitness_trail", "bicycle", "mtb", "horse", "ski", "piste", "canoe", "inline_skates"]
TRAIL_HIGHWAYS = {"path", "footway", "track", "bridleway", "cycleway"}
# Hike-feature nodes, matching feature_type() in extract-osm.py.
FEATURE_FILTERS = [
    "n/natural=spring,peak,volcano,saddle,waterfall", "n/amenity=drinking_water,water_point,shelter,parking,toilets,ranger_station",
    "n/tourism=camp_site,camp_pitch,wilderness_hut,alpine_hut,viewpoint,picnic_site", "n/highway=trailhead", "n/man_made=water_tap",
    "n/mountain_pass=yes", "n/ford=yes,stepping_stones", "n/leisure=picnic_site", "n/waterway=waterfall",
    # Closed ways for camp sites, huts and shelters drawn as areas (their centroid becomes the feature).
    "w/tourism=camp_site,wilderness_hut,alpine_hut", "w/amenity=shelter",
]
PIECE = 64 * 1024 * 1024


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def stream(url: str, sink, connections: int) -> None:
    """Writes the whole file at `url` to `sink` in order, fetching pieces over parallel range requests."""
    total = size_of(url)
    count = (total + PIECE - 1) // PIECE
    window = connections * 2  # pieces held in memory at most (64 MB each)

    def get(i: int) -> bytes:
        start, end = i * PIECE, min(total, (i + 1) * PIECE) - 1
        for attempt in range(10):
            r = subprocess.run(["curl", "-sSfL", "-A", AGENT, "--retry", "5", "--retry-all-errors", "--speed-limit", "100000",
                                "--speed-time", "60", "-r", f"{start}-{end}", url], capture_output=True)
            if r.returncode == 0 and len(r.stdout) == end - start + 1:
                return r.stdout
            time.sleep(5 * (attempt + 1))
        raise RuntimeError(f"piece {i} failed: {r.stderr.decode()[:200]}")

    started = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=connections) as pool:
        futures = []
        for i in range(count):
            # Write the oldest piece first when the window is full, then any finished pieces at the front.
            while len(futures) >= window:
                sink.write(futures.pop(0).result())
            futures.append(pool.submit(get, i))
            while futures and futures[0].done():
                sink.write(futures.pop(0).result())
            if i and i % 80 == 0:
                log(f"  {i * PIECE / 1e9:.0f} of {total / 1e9:.0f} GB")
        for f in futures:
            sink.write(f.result())
    sink.close()
    log(f"streamed {total / 1e9:.1f} GB in {(time.time() - started) / 60:.0f} min")


def run_stream(url: str, consumers: list[list[str]], connections: int) -> None:
    """Streams the planet into every consumer command at once (each reads PBF from stdin)."""
    procs = [subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=sys.stdout, stderr=sys.stderr, bufsize=16 * 1024 * 1024) for cmd in consumers]

    class Tee:
        def write(self, data: bytes) -> None:
            for p in procs:
                p.stdin.write(data)

        def close(self) -> None:
            for p in procs:
                p.stdin.close()

    stream(url, Tee(), connections)
    for p, cmd in zip(procs, consumers):
        # osmium getid exits 1 when some requested ids aren't in the input (members of other extracts, deleted objects).
        if p.wait() != 0 and not (cmd[1] == "getid" and p.returncode == 1):
            raise SystemExit(f"{' '.join(cmd[:3])} failed (exit {p.returncode})")


def wait_for_disk(gb: float) -> None:
    """Waits until `gb` of disk is free (another pipeline step may be using the disk at the same time)."""
    while shutil.disk_usage(ROOT).free / 1e9 < gb:
        log(f"waiting for {gb:.0f} GB of free disk ({shutil.disk_usage(ROOT).free / 1e9:.1f} GB now)")
        time.sleep(300)


def named_way_ids(out: str) -> None:
    """Consumer: ids of named trail-type ways and of piste ways read from stdin (PBF), saved as a numpy array."""
    ids = []
    processor = osmium.FileProcessor(osmium.io.File("-", "pbf"), osmium.osm.WAY).with_filter(osmium.filter.KeyFilter("name", "piste:type", "ref"))
    for way in processor:
        tags = way.tags
        if "piste:type" in tags or (tags.get("highway") in TRAIL_HIGHWAYS and ("name" in tags or "ref" in tags)):
            ids.append(way.id)
    np.save(out + ".tmp.npy", np.unique(np.array(ids, dtype=np.int64)))
    os.replace(out + ".tmp.npy", out)
    log(f"{len(ids):,} named trail and piste ways")


def relation_member_ids(rels_pbf: str) -> tuple[np.ndarray, np.ndarray]:
    """Way and relation ids used by the route relations."""
    ways, rels = [], []
    for rel in osmium.FileProcessor(rels_pbf, osmium.osm.RELATION):
        for m in rel.members:
            if m.type == "w":
                ways.append(m.ref)
            elif m.type == "r":
                rels.append(m.ref)
    return np.unique(np.array(ways, dtype=np.int64)), np.unique(np.array(rels, dtype=np.int64))


def write_ids(path: str, prefix: str, ids: np.ndarray) -> None:
    with open(path + ".tmp", "w") as f:
        for i in range(0, len(ids), 5_000_000):
            f.write("\n".join(f"{prefix}{x}" for x in ids[i:i + 5_000_000].tolist()))
            f.write("\n")
    os.replace(path + ".tmp", path)


def way_node_ids(ways_pbf: list[str], out: str) -> int:
    """Unique node ids of every way in the `ways_pbf` files, written as an osmium id file.

    Ids are marked in a bitmap (one bit per possible id, ~1.7 GB for the planet's ~13 billion), so memory stays
    flat however many hundred million node references the ways have."""
    bitmap = np.zeros(1 << 20, dtype=np.uint8)
    buf = []

    def mark(ids: np.ndarray) -> np.ndarray:
        nonlocal bitmap
        need = int(ids.max()) // 8 + 1
        if need > len(bitmap):
            grown = np.zeros(max(need, len(bitmap) * 2), dtype=np.uint8)
            grown[:len(bitmap)] = bitmap
            bitmap = grown
        np.bitwise_or.at(bitmap, ids >> 3, (1 << (ids & 7)).astype(np.uint8))
        return bitmap

    for source in ways_pbf:
        for way in osmium.FileProcessor(source, osmium.osm.WAY):
            buf.extend(n.ref for n in way.nodes)
            if len(buf) > 20_000_000:
                mark(np.array(buf, dtype=np.int64))
                buf = []
    if buf:
        mark(np.array(buf, dtype=np.int64))
    count = 0
    block = 1 << 24  # bytes of bitmap per step (134 million ids)
    with open(out + ".tmp", "w") as f:
        for start in range(0, len(bitmap), block):
            ids = np.flatnonzero(np.unpackbits(bitmap[start:start + block], bitorder="little")) + start * 8
            if len(ids):
                f.write("\n".join(f"n{x}" for x in ids.tolist()))
                f.write("\n")
                count += len(ids)
    os.replace(out + ".tmp", out)
    return count


def country_extracts(trails_pbf: str) -> list[str]:
    """Splits the trails planet into one file per country (Natural Earth outlines); route relations are kept whole,
    so a trail that crosses a border is complete in each country's file."""
    countries = json.load(open(os.path.join(WORK, "countries.json")))
    os.makedirs(os.path.join(WORK, "countries"), exist_ok=True)
    names = []
    todo = [c for c in countries if not os.path.exists(os.path.join(OUT, f"{c['code']}.json.gz"))]
    # Each extract holds id sets of a few hundred MB, so countries are split off 15 at a time.
    for start in range(0, len(todo), 15):
        batch = todo[start:start + 15]
        config = {"directory": os.path.join(WORK, "countries"), "extracts": [
            {"output": f"{c['code']}.osm.pbf", "multipolygon": c["polygons"]} for c in batch]}
        path = os.path.join(WORK, "extracts.json")
        json.dump(config, open(path, "w"))
        subprocess.run(["osmium", "extract", "--overwrite", "-s", "smart", "-S", "types=multipolygon,route", "-c", path, trails_pbf], check=True, stdout=subprocess.DEVNULL)
        names += [c["code"] for c in batch]
        log(f"split {len(names)} of {len(todo)} countries")
    return names


def main() -> None:
    url = sys.argv[sys.argv.index("--planet") + 1] if "--planet" in sys.argv else PLANET
    connections = int(sys.argv[sys.argv.index("--connections") + 1]) if "--connections" in sys.argv else 12
    if len(sys.argv) > 2 and sys.argv[1] == "--named-ways":
        named_way_ids(sys.argv[2])
        return
    for d in (WORK, OUT, FEATURES):
        os.makedirs(d, exist_ok=True)
    p = lambda name: os.path.join(WORK, name)  # noqa: E731
    merged = p("trails.osm.pbf")  # the trails planet: everything the three streams kept
    trails = p("trails-renumbered.osm.pbf")  # the same with its nodes renumbered

    if not os.path.exists(trails) and not os.path.exists(merged):
        # ---- stream 1: relations, named way ids, feature nodes ----
        if not (os.path.exists(p("rels.osm.pbf")) and os.path.exists(p("named.npy")) and os.path.exists(p("features.osm.pbf"))):
            log("stream 1: route relations, named trail ways, hike features")
            run_stream(url, [
                ["osmium", "tags-filter", "-F", "pbf", "-", "-R", "--overwrite", "-o", p("rels.osm.pbf"),
                 "r/route=" + ",".join(ROUTES)],
                [sys.executable, os.path.abspath(__file__), "--named-ways", p("named.npy")],
                ["osmium", "tags-filter", "-F", "pbf", "-", "-R", "--overwrite", "-o", p("features.osm.pbf"), *FEATURE_FILTERS],
            ], connections)
        # ---- stream 2: ways ----
        if not os.path.exists(p("ways.osm.pbf")):
            member_ways, _ = relation_member_ids(p("rels.osm.pbf"))
            way_ids = np.union1d(member_ways, np.load(p("named.npy")))
            write_ids(p("way-ids.txt"), "w", way_ids)
            log(f"stream 2: {len(way_ids):,} ways ({len(member_ways):,} in route relations)")
            run_stream(url, [["osmium", "getid", "-F", "pbf", "-", "-i", p("way-ids.txt"), "--overwrite", "-o", p("ways.osm.pbf")]], connections)
        # ---- stream 3: nodes ----
        if not os.path.exists(p("nodes.osm.pbf")):
            count = way_node_ids([p("ways.osm.pbf"), p("features.osm.pbf")], p("node-ids.txt"))
            log(f"stream 3: {count:,} nodes")
            wait_for_disk(count * 30 / 1e9 + 2)
            run_stream(url, [["osmium", "getid", "-F", "pbf", "-", "-i", p("node-ids.txt"), "--overwrite", "-o", p("nodes.osm.pbf")]], connections)
        wait_for_disk(sum(os.path.getsize(p(n)) for n in ("nodes.osm.pbf", "features.osm.pbf", "ways.osm.pbf", "rels.osm.pbf")) / 1e9 * 1.2 + 2)
        log("merging the trails planet")
        subprocess.run(["osmium", "merge", "--overwrite", "-o", merged, p("nodes.osm.pbf"), p("features.osm.pbf"), p("ways.osm.pbf"), p("rels.osm.pbf")], check=True)
        for name in ("way-ids.txt", "node-ids.txt", "nodes.osm.pbf", "ways.osm.pbf"):
            if os.path.exists(p(name)):
                os.remove(p(name))

    if not os.path.exists(trails):
        # osmium extract keeps id sets sized by the largest id; renumbering the nodes (whose ids nothing downstream
        # uses) keeps them small. Way and relation ids stay, since trail ids and OpenStreetMap links use them.
        log("renumbering nodes")
        subprocess.run(["osmium", "renumber", "-t", "node", "--overwrite", "-o", trails, merged], check=True)
        os.remove(merged)
    wait_for_disk(os.path.getsize(trails) / 1e9 * 1.5 + 2)
    codes = country_extracts(trails)
    index = f"sparse_file_array,{p('nodes.idx')}"
    for code in sorted(codes, key=lambda c: -os.path.getsize(p(f"countries/{c}.osm.pbf"))):
        pbf = p(f"countries/{code}.osm.pbf")
        target, feature_target = os.path.join(OUT, f"{code}.json.gz"), os.path.join(FEATURES, f"{code}.json.gz")
        started = time.time()
        for mode, out, env in (("--parse", target, {}), ("--features", feature_target, {"HYKED_TRAIL_CACHE": target})):
            if os.path.exists(out):
                continue
            if os.path.exists(p("nodes.idx")):
                os.remove(p("nodes.idx"))
            r = subprocess.run([sys.executable, EXTRACT, mode, pbf, out, "--index", index], capture_output=True, text=True, env={**os.environ, **env})
            if r.returncode != 0:
                log(f"{code}: {mode[2:]} failed ({r.stderr.strip()[-300:]})")
                break
            log(f"{code}: {r.stdout.strip()} ({time.time() - started:.0f}s)")
        os.remove(pbf)
    if os.path.exists(p("nodes.idx")):
        os.remove(p("nodes.idx"))
    shutil.rmtree(p("countries"), ignore_errors=True)
    log("done")


if __name__ == "__main__":
    main()
