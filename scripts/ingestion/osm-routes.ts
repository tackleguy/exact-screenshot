/**
 * OpenStreetMap route relations (hiking, foot, bicycle, mtb, horse, ski) for the United States and Canada.
 * Phase 1 lists relation ids tile by tile (cheap); phase 2 fetches each relation's member geometry once,
 * in batches. Every Overpass response is cached in .cache/osm-routes, so the run can stop and resume.
 * Output: data/sources/osm-routes.json.gz — one record per relation with its tags and ordered lines.
 * npx tsx scripts/ingestion/osm-routes.ts            (Overpass)
 * npx tsx scripts/ingestion/osm-routes.ts --pbf      (after osm-routes-pbf.py has extracted Geofabrik regions)
 * OSM data © OpenStreetMap contributors, ODbL 1.0.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import path from "node:path";
import { chainLines } from "../../src/lib/geo/line";
import { simplifyLine } from "../../src/lib/geo/simplify";

const root = process.cwd();
const cacheDir = path.join(root, ".cache/osm-routes");
/** Comma-separated OVERPASS_API_URL overrides the list (public instances come and go). */
const ENDPOINTS = (process.env.OVERPASS_API_URL ?? "https://maps.mail.ru/osm/tools/overpass/api/interpreter,https://overpass-api.de/api/interpreter").split(",").map((u) => u.trim()).filter(Boolean);
const ROUTE_VALUES = ["hiking", "foot", "bicycle", "mtb", "horse", "ski"];
/** Land boxes [west, south, east, north] covering the U.S. and Canada, cut into TILE-degree tiles. */
const BOXES: [number, number, number, number][] = [[-125, 24, -66, 50], [-170, 51, -129, 72], [-161, 18.5, -154, 22.5], [-141, 41.5, -52, 72]];
const TILE = 4;
const BATCH = 60;
const WORKERS = Number(process.env.OVERPASS_WORKERS ?? 2);
/** Member roles that are not the main line (side trips, alternates, access paths). */
const SKIP_ROLES = /^(alternative|excursion|approach|connection|link|platform|stop|guidepost|start|end|information|parking|shelter)/;

type Element = { type: string; id: number; tags?: Record<string, string>; members?: { type: string; ref: number; role: string; geometry?: { lat: number; lon: number }[] }[] };
type Pt = [number, number];

async function overpass(query: string, worker = 0, attempts = 6): Promise<{ elements: Element[] }> {
  const file = path.join(cacheDir, `${createHash("sha256").update(query).digest("hex").slice(0, 20)}.json.gz`);
  try { return JSON.parse(gunzipSync(await readFile(file)).toString()); } catch { /* fetch */ }
  for (let attempt = 0; attempt < attempts; attempt++) {
    const order = [...ENDPOINTS.slice(worker % ENDPOINTS.length), ...ENDPOINTS.slice(0, worker % ENDPOINTS.length)];
    for (const endpoint of attempt % 2 ? order.reverse() : order) {
      try {
        const response = await fetch(endpoint, { method: "POST", body: new URLSearchParams({ data: query }), headers: { "User-Agent": "Hyked/1.0 trail catalog (https://github.com/tackleguy/health)" }, signal: AbortSignal.timeout(240_000) });
        if (!response.ok) { console.log(`    ${new URL(endpoint).host} HTTP ${response.status}`); continue; }
        const text = await response.text();
        if (!text.startsWith("{")) { console.log(`    ${new URL(endpoint).host}: ${text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 160)}`); continue; }
        const data = JSON.parse(text);
        if (data.remark && /runtime error|timed out|out of memory/i.test(data.remark)) { console.log(`    ${new URL(endpoint).host}: ${data.remark.slice(0, 160)}`); continue; }
        await writeFile(file, gzipSync(text));
        return data;
      } catch (error) { console.log(`    ${new URL(endpoint).host}: ${(error as Error).message}`); }
    }
    if (attempt + 1 < attempts) await new Promise((r) => setTimeout(r, 20_000 * (attempt + 1)));
  }
  throw new Error(`Overpass unavailable for: ${query.slice(0, 120)}`);
}

async function pool<T>(items: T[], fn: (item: T, worker: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: WORKERS }, async (_, worker) => { while (next < items.length) await fn(items[next++], worker); }));
}

async function main() {
  await mkdir(cacheDir, { recursive: true });
  const fromPbf = process.argv.includes("--pbf");
  const tags = new Map<number, Record<string, string>>();
  const members = new Map<number, Element["members"]>();
  const ids: number[] = [];
  let failed = 0, done = 0;
  if (fromPbf) {
    // Regions extracted from Geofabrik by osm-routes-pbf.py; a relation crossing regions gets ways from each.
    const ways = new Map<number, Pt[]>();
    const rels = new Map<number, { tags: Record<string, string>; members: [string, number, string][] }>();
    const dir = path.join(root, ".cache/osm-pbf");
    for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json.gz"))) {
      const data = JSON.parse(gunzipSync(await readFile(path.join(dir, file))).toString()) as { relations: Record<string, { tags: Record<string, string>; members: [string, number, string][] }>; ways: Record<string, Pt[]> };
      for (const [id, r] of Object.entries(data.relations)) if (!rels.has(Number(id))) rels.set(Number(id), r);
      for (const [id, w] of Object.entries(data.ways)) if (!ways.has(Number(id))) ways.set(Number(id), w);
    }
    for (const [id, r] of rels) {
      tags.set(id, r.tags);
      members.set(id, r.members.map(([type, ref, role]) => ({ type: type === "w" ? "way" : type === "r" ? "relation" : "node", ref, role, ...(type === "w" && ways.has(ref) ? { geometry: ways.get(ref)!.map(([lon, lat]) => ({ lon, lat })) } : {}) })));
    }
    ids.push(...[...rels.keys()].sort((a, b) => a - b));
    console.log(`Read ${rels.size.toLocaleString("en-US")} relations and ${ways.size.toLocaleString("en-US")} ways from Geofabrik extracts.`);
  } else {
    const tiles: [number, number, number, number][] = [];
    for (const [w, s, e, n] of BOXES) for (let x = w; x < e; x += TILE) for (let y = s; y < n; y += TILE) tiles.push([x, y, Math.min(e, x + TILE), Math.min(n, y + TILE)]);

    // Phase 1: ids and tags of every matching relation.
    done = 0;
    // Exact route=… lookups use Overpass's tag index; a regex over every relation in the box times out.
    // Dense boxes that still time out are split into quarters, down to half a degree.
    const listBox = async ([w, s, e, n]: [number, number, number, number], worker: number): Promise<void> => {
      const box = `(${s},${w},${n},${e})`;
      const small = e - w <= 0.5;
      try {
        const data = await overpass(`[out:json][timeout:240];(${ROUTE_VALUES.map((v) => `relation[route=${v}]${box};`).join("")});out ids tags;`, worker, small ? 6 : 1);
        for (const el of data.elements) if (el.type === "relation" && /^(route|superroute)$/.test(el.tags?.type ?? "")) tags.set(el.id, el.tags ?? {});
      } catch (error) {
        if (small) throw error;
        const mx = (w + e) / 2, my = (s + n) / 2;
        for (const q of [[w, s, mx, my], [mx, s, e, my], [w, my, mx, n], [mx, my, e, n]] as [number, number, number, number][]) await listBox(q, worker);
      }
    };
    await pool(tiles, async (tile, worker) => {
      await listBox(tile, worker);
      if (++done % 25 === 0) console.log(`  phase 1: ${done}/${tiles.length} tiles, ${tags.size.toLocaleString("en-US")} relations`);
    });
    console.log(`Phase 1: ${tags.size.toLocaleString("en-US")} route relations in ${tiles.length} tiles.`);

    // Phase 2: member geometry, each relation once.
    ids.push(...[...tags.keys()].sort((a, b) => a - b));
    const batches: number[][] = [];
    for (let i = 0; i < ids.length; i += BATCH) batches.push(ids.slice(i, i + BATCH));
    done = 0;
    // A batch that times out is halved until single relations; a single relation that still fails is skipped.
    const fetchBatch = async (batch: number[], worker: number): Promise<void> => {
      try {
        const data = await overpass(`[out:json][timeout:240];relation(id:${batch.join(",")});out geom;`, worker, batch.length > 1 ? 2 : 4);
        for (const el of data.elements) if (el.type === "relation") members.set(el.id, el.members ?? []);
      } catch (error) {
        if (batch.length === 1) { failed++; console.log(`    skipped relation ${batch[0]}: ${(error as Error).message.slice(0, 80)}`); return; }
        const mid = Math.ceil(batch.length / 2);
        await fetchBatch(batch.slice(0, mid), worker);
        await fetchBatch(batch.slice(mid), worker);
      }
    };
    await pool(batches, async (batch, worker) => {
      await fetchBatch(batch, worker);
      if (++done % 20 === 0) console.log(`  phase 2: ${done}/${batches.length} batches`);
    });
  }

  // Assemble: own way members plus, for parent routes, their child routes' lines.
  const own = new Map<number, Pt[][]>();
  for (const [id, list] of members) {
    const lines: Pt[][] = [];
    for (const m of list ?? []) {
      if (m.type !== "way" || !m.geometry || m.geometry.length < 2 || SKIP_ROLES.test(m.role)) continue;
      lines.push(m.geometry.map((g) => [g.lon, g.lat] as Pt));
    }
    own.set(id, lines);
  }
  const resolved = new Map<number, Pt[][]>();
  const linesOf = (id: number, stack = new Set<number>()): Pt[][] => {
    if (resolved.has(id)) return resolved.get(id)!;
    if (stack.has(id)) return [];
    stack.add(id);
    const lines = [...(own.get(id) ?? [])];
    for (const m of members.get(id) ?? []) if (m.type === "relation" && !SKIP_ROLES.test(m.role)) lines.push(...linesOf(m.ref, stack));
    resolved.set(id, lines);
    return lines;
  };
  const routes = [];
  for (const id of ids) {
    const raw = linesOf(id);
    if (!raw.length) continue;
    const lines = chainLines(raw).map((l) => simplifyLine(l, 0.00003).map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5] as Pt)).filter((l) => l.length > 1);
    const children = (members.get(id) ?? []).filter((m) => m.type === "relation").map((m) => m.ref);
    routes.push({ id, tags: tags.get(id)!, children, lines });
  }
  await mkdir(path.join(root, "data/sources"), { recursive: true });
  await writeFile(path.join(root, "data/sources/osm-routes.json.gz"), gzipSync(JSON.stringify({ retrievedAt: new Date().toISOString(), license: "ODbL 1.0 — © OpenStreetMap contributors", routes })));
  console.log(`Wrote ${routes.length.toLocaleString("en-US")} routes with geometry (${ids.length - routes.length} without mapped ways; ${failed} could not be fetched).`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
