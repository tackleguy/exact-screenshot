// Bulk import of named OpenStreetMap hiking/foot route relations worldwide.
// Output: data/trail-catalog/osm-routes.json.gz (compact rows merged by prepare-trail-assets).
import { writeFile, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const ENDPOINT = "https://maps.mail.ru/osm/tools/overpass/api/interpreter";
const OUT = "data/trail-catalog/osm-routes.json.gz";
const PROGRESS = "/tmp/osm-routes-progress.json";

type Row = { id: number; n: string; lat: number; lon: number; km: number | null; d: string | null; net: string | null; op: string | null; w: string | null };

async function query(s: number, w: number, n: number, e: number): Promise<Row[]> {
  const q = `[out:json][timeout:170];relation["route"~"^(hiking|foot)$"]["name"](${s},${w},${n},${e});out center tags;`;
  const res = await fetch(`${ENDPOINT}?data=${encodeURIComponent(q)}`, { headers: { "User-Agent": "HykedTrailImport/1.0 (hyked.lovable.app)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.includes('"remark"') && /runtime error|timed out|out of memory/i.test(text)) throw new Error("overpass remark");
  const json = JSON.parse(text);
  return json.elements.filter((x: any) => x.center && x.tags?.name).map((x: any) => {
    const t = x.tags; const dist = parseFloat(String(t.distance ?? "").replace(",", "."));
    return { id: x.id, n: t["name:en"] || t.name, lat: x.center.lat, lon: x.center.lon, km: Number.isFinite(dist) && dist > 0 && dist < 15000 ? dist : null,
      d: t.sac_scale ?? null, net: t.network ?? null, op: t.operator ?? null, w: t.website ?? null };
  });
}

async function tile(s: number, w: number, n: number, e: number, depth = 0): Promise<Row[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await query(s, w, n, e); }
    catch (err) {
      if (depth < 3 && attempt === 1) {
        const ms = (s + n) / 2, mw = (w + e) / 2;
        const parts = await Promise.all([[s, w, ms, mw], [s, mw, ms, e], [ms, w, n, mw], [ms, mw, n, e]].map(([a, b, c, d]) => tile(a, b, c, d, depth + 1)));
        return parts.flat();
      }
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  console.warn(`gave up ${s},${w},${n},${e}`); return [];
}

async function main() {
  const done: Record<string, Row[]> = await readFile(PROGRESS, "utf8").then(JSON.parse).catch(() => ({}));
  const tiles: number[][] = [];
  for (let s = -56; s < 72; s += 8) for (let w = -180; w < 180; w += 10) tiles.push([s, w, s + 8, w + 10]);
  let i = 0;
  const worker = async () => {
    while (i < tiles.length) {
      const t = tiles[i++]; const key = t.join(",");
      if (done[key]) continue;
      done[key] = await tile(t[0], t[1], t[2], t[3]);
      await writeFile(PROGRESS, JSON.stringify(done));
      console.log(`${Object.keys(done).length}/${tiles.length} ${key} +${done[key].length}`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const byId = new Map<number, Row>();
  for (const rows of Object.values(done)) for (const r of rows) byId.set(r.id, r);
  await writeFile(OUT, gzipSync(JSON.stringify([...byId.values()])));
  console.log(`Saved ${byId.size} OSM routes`);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
