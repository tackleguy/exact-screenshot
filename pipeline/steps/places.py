#!/usr/bin/env python3
"""
Country and first-level region outlines for worldwide trails, from Natural Earth (public domain).

    python3 pipeline/steps/places.py

Downloads Natural Earth 1:10m admin-0 countries and admin-1 states/provinces (cached in .cache/ne/) and writes
  .cache/world-work/countries.json   one outline per country (ISO 3166-1 alpha-2), widened by ~3 km so coastal
                                     and border trails are kept, for splitting the trails planet with osmium extract.
                                     The U.S. and Canada come from the regional extracts (extract-osm.py) except
                                     Alaska and Hawaii, which the regional mirror doesn't publish.
  data/sources/world-admin1.json.gz  every state/province/region outline (simplified), so the build can name the
                                     country and region of each trail.
Requires pyshp and shapely (`pip install --user pyshp shapely`).
"""
from __future__ import annotations

import gzip
import json
import os
import subprocess
import zipfile

import shapefile
from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union

ROOT = os.getcwd()
NE = os.path.join(ROOT, ".cache/ne")
ADMIN0 = "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip"
ADMIN1 = "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip"
# Natural Earth areas without an ISO code, folded into the country that administers them.
NO_CODE = {"Somaliland": "SO", "N. Cyprus": "CY", "Siachen Glacier": "IN", "Akrotiri": "GB", "Dhekelia": "GB",
           "USNB Guantanamo Bay": "CU", "Southern Patagonian Ice Field": "AR", "Bir Tawil": "SD"}
REGIONAL = {"US", "CA"}  # covered by extract-osm.py
EXTRA = {"US-AK": ("US", "Alaska"), "US-HI": ("US", "Hawaii")}


def reader(url: str, name: str) -> shapefile.Reader:
    os.makedirs(NE, exist_ok=True)
    archive = os.path.join(NE, f"{name}.zip")
    if not os.path.exists(archive):
        subprocess.run(["curl", "-sSfL", "-o", archive, url], check=True)
    with zipfile.ZipFile(archive) as z:
        z.extractall(NE)
    return shapefile.Reader(os.path.join(NE, f"{name}.shp"), encoding="utf-8")


def polygons(geom) -> list:
    g = mapping(geom)
    coords = g["coordinates"]
    return [coords] if g["type"] == "Polygon" else list(coords)


def rounded(rings, digits=3):
    return [[[round(x, digits), round(y, digits)] for x, y in ring] for ring in rings]


def main() -> None:
    a0 = reader(ADMIN0, "ne_10m_admin_0_countries")
    a1 = reader(ADMIN1, "ne_10m_admin_1_states_provinces")
    by_code: dict[str, list] = {}
    names: dict[str, str] = {}
    for sr in a0.iterShapeRecords():
        rec = sr.record.as_dict()
        code = rec["ISO_A2_EH"] if rec["ISO_A2_EH"] != "-99" else NO_CODE.get(rec["NAME"])
        if not code or code in REGIONAL:
            continue
        by_code.setdefault(code, []).append(shape(sr.shape.__geo_interface__))
        if rec["ISO_A2_EH"] == code:
            names[code] = rec["NAME_LONG"] or rec["NAME"]
    admin1 = []
    for sr in a1.iterShapeRecords():
        rec = sr.record.as_dict()
        code = rec["iso_a2"] if rec["iso_a2"] not in ("-99", "") else None
        if not code:
            continue
        geom = shape(sr.shape.__geo_interface__)
        for key, (country, region) in EXTRA.items():
            if code == country and rec["name"] == region:
                by_code[key] = [geom]
                names[key] = region
        simple = geom.simplify(0.01, preserve_topology=True)
        if simple.is_empty:
            continue
        minx, miny, maxx, maxy = geom.bounds
        admin1.append({"c": code, "n": rec["name_en"] or rec["name"], "b": [round(minx, 3), round(miny, 3), round(maxx, 3), round(maxy, 3)],
                       "p": [rounded(poly) for poly in polygons(simple)]})
    countries = []
    for code, geoms in sorted(by_code.items()):
        # Widened by ~3 km, then clipped to the valid lon/lat range (osmium rejects points past ±180°).
        outline = unary_union(geoms).buffer(0.03, quad_segs=2).simplify(0.01, preserve_topology=True).intersection(box(-180, -90, 180, 90))
        countries.append({"code": code, "name": names.get(code, code), "polygons": [rounded(p, 4) for p in polygons(outline)]})
    os.makedirs(os.path.join(ROOT, ".cache/world-work"), exist_ok=True)
    with open(os.path.join(ROOT, ".cache/world-work/countries.json"), "w") as f:
        json.dump(countries, f, separators=(",", ":"))
    with gzip.open(os.path.join(ROOT, "data/sources/world-admin1.json.gz"), "wt", compresslevel=9) as f:
        json.dump({"source": "Natural Earth 1:10m admin-1 states and provinces (public domain), v5.1", "regions": admin1}, f, separators=(",", ":"))
    print(f"{len(countries)} country outlines, {len(admin1)} regions")


if __name__ == "__main__":
    main()
