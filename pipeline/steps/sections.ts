/**
 * Sections together: links OpenStreetMap routes to the stages they are made of. A route relation whose members
 * include other route relations (a long-distance trail split into stages, a regional network, a superroute) gets
 * `sections` — its stages in route order — and every stage gets `partOfRoute` pointing at the smallest route
 * that contains it, so each stage page links to the whole trail and the whole trail lists its stages.
 *
 * Runs after build.ts and world.ts, on the current snapshot; reads relation members from the extracted OSM
 * region files (.cache/osm-pbf, .cache/world-pbf) and rewrites the index files (checksums updated).
 *
 * Usage: NODE_OPTIONS=--max-old-space-size=12000 npx tsx pipeline/steps/sections.ts
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import path from "node:path";
import type { CatalogManifest, CatalogTrail } from "../../src/lib/trail-catalog/types";
import { readOsmRegion } from "./osm-trails";

const root = process.cwd();
const catalogRoot = path.join(root, "data/trail-catalog");
const SKIP_ROLES = /^(alternative|excursion|approach|connection|link|platform|stop|guidepost|start|end|information|parking|shelter)/;
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
/** A route with more stages than this is a network listing, not a trail split into sections. */
const MAX_SECTIONS = 120;

async function main() {
  const { directory } = JSON.parse(await readFile(path.join(catalogRoot, "current.json"), "utf8")) as { directory: string };
  const dir = path.join(catalogRoot, directory);
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as CatalogManifest & { world?: { files: Record<string, { rows: number; sha256: string }> } };

  // 1. Child route relations of every relation, in member order.
  const children = new Map<number, number[]>();
  for (const cache of [".cache/osm-pbf", ".cache/world-pbf"]) {
    const files = (await readdir(path.join(root, cache)).catch(() => [] as string[])).filter((f) => f.endsWith(".json.gz"));
    for (const file of files) {
      const { relations } = await readOsmRegion(path.join(root, cache, file), ["relations"]);
      for (const [id, r] of Object.entries(relations)) {
        if (children.has(Number(id))) continue;
        const kids = r.members.filter(([t, , role]) => t === "r" && !SKIP_ROLES.test(role)).map(([, ref]) => ref);
        if (kids.length) children.set(Number(id), kids);
      }
    }
  }
  console.log(`${children.size.toLocaleString("en-US")} relations with route members`);

  // 2. Every catalog row that is a relation (an official record merged with a relation keeps its osm info).
  const naBuf = await readFile(path.join(dir, "index.json.gz"));
  const na = JSON.parse(gunzipSync(naBuf).toString()) as CatalogTrail[];
  const world = new Map<string, { rows: CatalogTrail[]; redirects: Record<string, string> }>();
  for (const code of Object.keys(manifest.world?.files ?? {})) world.set(code, JSON.parse(gunzipSync(await readFile(path.join(dir, "world", `index-${code}.json.gz`))).toString()));
  const shown = (r: CatalogTrail) => !r.mergedInto && r.confidence !== "REJECTED";
  const byRelation = new Map<number, CatalogTrail>();
  for (const r of [...na, ...[...world.values()].flatMap((w) => w.rows)]) if (r.osm && shown(r) && !byRelation.has(r.osm.relation)) byRelation.set(r.osm.relation, r);

  // 3. Parents list their stages; each stage points at its smallest parent.
  let parents = 0, linked = 0;
  const best = new Map<CatalogTrail, CatalogTrail>();
  for (const [pid, kids] of children) {
    const parent = byRelation.get(pid);
    if (!parent) continue;
    const stages = kids.map((k) => byRelation.get(k)).filter((r): r is CatalogTrail => Boolean(r) && r!.id !== parent.id);
    if (!stages.length || stages.length > MAX_SECTIONS) continue;
    parent.sections = stages.map((s) => ({ id: s.id, name: s.name, miles: s.miles ?? 0, difficulty: s.difficulty ?? null }));
    parents++;
    for (const s of stages) {
      const current = best.get(s);
      if (!current || (parent.miles ?? Infinity) < (current.miles ?? Infinity)) best.set(s, parent);
    }
  }
  for (const [stage, parent] of best) { stage.partOfRoute = { id: parent.id, name: parent.name, totalMiles: parent.miles ?? 0 }; linked++; }
  console.log(`${parents.toLocaleString("en-US")} routes list their sections; ${linked.toLocaleString("en-US")} sections link to their route`);

  // 4. Write back with new checksums.
  const naOut = gzipSync(JSON.stringify(na), { level: 9 });
  await writeFile(path.join(dir, "index.json.gz"), naOut);
  manifest.indexSha256 = sha(naOut);
  for (const [code, data] of world) {
    const buf = gzipSync(JSON.stringify(data), { level: 9 });
    await writeFile(path.join(dir, "world", `index-${code}.json.gz`), buf);
    manifest.world!.files[code].sha256 = sha(buf);
  }
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
