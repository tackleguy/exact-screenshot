/**
 * Pieces together: one named trail that the map data splits into pieces (a beach walk broken where it crosses
 * sand, a coastal path cut by a road, a greenway interrupted by a car park) becomes one trail. Pieces join when
 * they share a name, country and activity and an end of one comes within JOIN_METERS of the other. The
 * longest piece keeps its page and gains every piece's line; the others redirect to it. Gaps are left as gaps —
 * no line is drawn across them — and the distance is the sum of the mapped pieces only.
 *
 * Route relations (they are already whole routes or their stages) and unnamed paths are never joined.
 *
 * Runs after build.ts and world.ts, before sections.ts, on the current snapshot; rewrites the index files and the
 * geometry cells it changes (checksums updated).
 *
 * Usage: NODE_OPTIONS=--max-old-space-size=12000 npx tsx pipeline/steps/join.ts
 */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import path from "node:path";
import type { CatalogManifest, CatalogTrail } from "../../src/lib/trail-catalog/types";
import { sectionOf, trailActivities } from "../../src/lib/trail-catalog/activity";
import { qualityScore } from "../../src/lib/trail-catalog/score";
import { metersBetween } from "../../src/lib/trail-catalog/quality";
import { normalizeText } from "../../src/lib/trail-catalog/fuzzy";

export const JOIN_METERS = 400;
type Lines = [number, number][][];
const root = process.cwd();
const catalogRoot = path.join(root, "data/trail-catalog");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Rows that may be joined: shown, single-way trails with a real name and a line. */
const joinable = (r: CatalogTrail) =>
  !r.mergedInto && r.confidence !== "REJECTED" && r.quality !== "fragment" && r.kind === "segment" && !r.osm &&
  r.source !== "resort" && r.geometryShard && r.geometryShard !== "route" && !/^unnamed/i.test(r.name) && !r.originalName;

const groupKey = (r: CatalogTrail) => `${r.country}|${normalizeText(r.name)}|${[...new Set(trailActivities(r).map((a) => sectionOf(a).key))].sort().join(",")}`;

/** True when an end of either piece comes within JOIN_METERS of the other piece. */
function touches(a: Lines, b: Lines) {
  const ends = (ls: Lines) => ls.flatMap((l) => (l.length ? [l[0], l[l.length - 1]] : []));
  const near = (pts: [number, number][], ls: Lines) => pts.some((p) => ls.some((l) => l.some((q) => metersBetween(p, q) <= JOIN_METERS)));
  return near(ends(a), b) || near(ends(b), a);
}
const boxOf = (ls: Lines) => {
  let w = 180, s = 90, e = -180, n = -90;
  for (const l of ls) for (const [x, y] of l) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [w, s, e, n] as const;
};
const pad = JOIN_METERS / 100_000;
const boxesNear = (a: readonly number[], b: readonly number[]) => a[0] - pad * 2 <= b[2] && b[0] - pad * 2 <= a[2] && a[1] - pad <= b[3] && b[1] - pad <= a[3];

/** Geometry cells, loaded on demand and written back when changed. */
class Shards {
  private data = new Map<string, Record<string, Lines>>();
  private dirty = new Set<string>();
  constructor(private dir: string) {}
  async get(shard: string) {
    let hit = this.data.get(shard);
    if (!hit) {
      hit = await readFile(path.join(this.dir, `geometry-${shard}.json.gz`)).then((b) => JSON.parse(gunzipSync(b).toString())).catch(() => ({}));
      this.data.set(shard, hit!);
    }
    return hit!;
  }
  touch(shard: string) { this.dirty.add(shard); }
  async flush() {
    for (const shard of this.dirty) await writeFile(path.join(this.dir, `geometry-${shard}.json.gz`), gzipSync(JSON.stringify(this.data.get(shard)), { level: 9 }));
    const n = this.dirty.size;
    this.data.clear();
    this.dirty.clear();
    return n;
  }
}

/** Joins the pieces in `rows`; returns the ids that now redirect, mapped to the trail they joined. */
async function joinRows(rows: CatalogTrail[], shards: Shards) {
  const groups = new Map<string, CatalogTrail[]>();
  for (const r of rows) if (joinable(r)) (groups.get(groupKey(r)) ?? groups.set(groupKey(r), []).get(groupKey(r))!).push(r);
  const redirects: Record<string, string> = {};
  let joined = 0;
  for (const pieces of groups.values()) {
    if (pieces.length < 2) continue;
    const lines = await Promise.all(pieces.map(async (p) => (await shards.get(p.geometryShard))[p.id] ?? []));
    const boxes = lines.map(boxOf);
    const parent = pieces.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
      if (find(i) === find(j) || !lines[i].length || !lines[j].length || !boxesNear(boxes[i], boxes[j])) continue;
      if (touches(lines[i], lines[j])) parent[find(i)] = find(j);
    }
    const components = new Map<number, number[]>();
    for (let i = 0; i < pieces.length; i++) (components.get(find(i)) ?? components.set(find(i), []).get(find(i))!).push(i);
    for (const members of components.values()) {
      if (members.length < 2) continue;
      members.sort((a, b) => (pieces[b].miles ?? 0) - (pieces[a].miles ?? 0));
      const main = pieces[members[0]];
      const all: Lines = members.flatMap((i) => lines[i]);
      const miles = Math.round(members.reduce((t, i) => t + (pieces[i].miles ?? 0), 0) * 1000) / 1000;
      const ways = members.flatMap((i) => pieces[i].osmWay?.ids ?? []);
      main.miles = miles;
      main.sectionCount = members.reduce((t, i) => t + (pieces[i].sectionCount ?? 1), 0);
      if (main.osmWay && ways.length) main.osmWay = { ...main.osmWay, ids: [...new Set(ways)] };
      main.routeType = "network";
      main.factSources = { ...main.factSources, miles: `Sum of ${members.length} mapped pieces of this named trail (gaps between pieces are not drawn or counted)` };
      main.tier = members.some((i) => pieces[i].tier === "verified") ? "verified" : main.tier;
      main.qualityScore = qualityScore(main);
      (await shards.get(main.geometryShard))[main.id] = all;
      shards.touch(main.geometryShard);
      for (const i of members.slice(1)) {
        const p = pieces[i];
        redirects[p.id] = main.id;
        const cell = await shards.get(p.geometryShard);
        if (cell[p.id]) { delete cell[p.id]; shards.touch(p.geometryShard); }
      }
      joined++;
    }
  }
  return { redirects, joined };
}

async function main() {
  const { directory } = JSON.parse(await readFile(path.join(catalogRoot, "current.json"), "utf8")) as { directory: string };
  const dir = path.join(catalogRoot, directory);
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as CatalogManifest & { tiers?: { verified: number; mapped: number }; world?: { files: Record<string, { rows: number; sha256: string }>; countries: Record<string, number>; verified: number; mapped: number } };
  const w = manifest.world ?? { files: {}, countries: {}, verified: 0, mapped: 0 };
  let trails = 0, pieces = 0;

  // U.S. and Canada: joined pieces stay in the index, marked as merged into the trail they joined.
  const na = JSON.parse(gunzipSync(await readFile(path.join(dir, "index.json.gz"))).toString()) as CatalogTrail[];
  const naShards = new Shards(dir);
  const naResult = await joinRows(na, naShards);
  for (const r of na) if (naResult.redirects[r.id]) {
    r.mergedInto = naResult.redirects[r.id];
    if (manifest.countries?.[r.country]) manifest.countries[r.country]--;
  }
  trails += naResult.joined; pieces += Object.keys(naResult.redirects).length;
  const naCells = await naShards.flush();
  const naOut = gzipSync(JSON.stringify(na), { level: 9 });
  await writeFile(path.join(dir, "index.json.gz"), naOut);
  manifest.indexSha256 = sha(naOut);
  console.log(`U.S./Canada: ${naResult.joined.toLocaleString("en-US")} trails from ${Object.keys(naResult.redirects).length.toLocaleString("en-US")} extra pieces; ${naCells} geometry cells rewritten`);

  // Worldwide: joined pieces leave the country index and redirect.
  const worldShards = new Shards(path.join(dir, "world"));
  for (const code of Object.keys(manifest.world?.files ?? {})) {
    const file = path.join(dir, "world", `index-${code}.json.gz`);
    const data = JSON.parse(gunzipSync(await readFile(file)).toString()) as { rows: CatalogTrail[]; redirects: Record<string, string> };
    const { redirects, joined } = await joinRows(data.rows, worldShards);
    if (!joined) continue;
    const removed = data.rows.filter((r) => redirects[r.id]);
    data.rows = data.rows.filter((r) => !redirects[r.id]);
    // Earlier redirects that pointed at a piece now point at the joined trail.
    for (const [from, to] of Object.entries(data.redirects)) if (redirects[to]) data.redirects[from] = redirects[to];
    Object.assign(data.redirects, redirects);
    await worldShards.flush();
    const buf = gzipSync(JSON.stringify(data), { level: 9 });
    await writeFile(file, buf);
    manifest.world!.files[code] = { rows: data.rows.length, sha256: sha(buf) };
    // Counts drop by the pieces that now redirect.
    for (const r of removed) {
      if (manifest.countries?.[r.country]) manifest.countries[r.country]--;
      if (w.countries?.[r.country]) w.countries[r.country]--;
      if (r.tier === "verified" || r.tier === "mapped") { w[r.tier]--; if (manifest.tiers) manifest.tiers[r.tier]--; }
    }
    trails += joined; pieces += Object.keys(redirects).length;
  }
  manifest.notes = [...(manifest.notes ?? []).filter((n) => !n.startsWith("Pieces together")), `Pieces together: ${trails.toLocaleString("en-US")} named trails that map data splits into pieces were joined (${pieces.toLocaleString("en-US")} pieces, ends within ${JOIN_METERS} m, same name and activity); gaps between pieces are not drawn or counted.`];
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`${trails.toLocaleString("en-US")} trails joined from ${pieces.toLocaleString("en-US")} extra pieces`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
