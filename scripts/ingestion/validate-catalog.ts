/**
 * Validation report for the current catalog snapshot: coverage of names, OSM relations, official sources,
 * lines (elevation, water and towns are computed from the line when a trail page opens), Wikipedia, photos and
 * trailheads, plus 10 random trails with their key fields.
 * npx tsx scripts/ingestion/validate-catalog.ts [--seed=7]
 */
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import type { CatalogTrail } from "../../src/lib/trail-catalog/types";
import { resolveDifficulty, DIFFICULTY_LABELS } from "../../src/lib/trail-difficulty";

const OFFICIAL = new Set(["NPS_OFFICIAL", "USFS_OFFICIAL", "BLM_OFFICIAL", "PARKS_CANADA_OFFICIAL", "STATE_AGENCY", "LOCAL_AGENCY"]);

async function main() {
  const root = path.join(process.cwd(), "data/trail-catalog");
  const dir = path.join(root, JSON.parse(await readFile(path.join(root, "current.json"), "utf8")).directory);
  const rows = JSON.parse(gunzipSync(await readFile(path.join(dir, "index.json.gz"))).toString()) as CatalogTrail[];
  const shown = rows.filter((r) => !r.mergedInto && r.confidence !== "REJECTED" && r.quality !== "fragment");
  const pct = (f: (r: CatalogTrail) => boolean) => `${((shown.filter(f).length / shown.length) * 100).toFixed(1)}%`;
  const cells = new Map<string, Record<string, unknown>>();
  let withLine = 0;
  for (const r of shown) {
    if (r.source === "resort") continue;
    if (!cells.has(r.geometryShard)) {
      try { cells.set(r.geometryShard, JSON.parse(gunzipSync(await readFile(path.join(dir, `geometry-${r.geometryShard}.json.gz`))).toString())); } catch { cells.set(r.geometryShard, {}); }
    }
    if (cells.get(r.geometryShard)![r.id]) withLine++;
  }
  console.log(`Snapshot ${path.basename(dir)}`);
  console.log(`Trails shown:              ${shown.length.toLocaleString("en-US")} (${rows.filter((r) => r.mergedInto).length.toLocaleString("en-US")} official records merged into whole trails)`);
  console.log(`Named:                     ${pct((r) => !/^unnamed/i.test(r.name) && !r.originalName)}`);
  console.log(`OSM route relation:        ${pct((r) => Boolean(r.osm))}`);
  console.log(`Official source match:     ${pct((r) => Boolean((r.sourceType && OFFICIAL.has(r.sourceType)) || r.sources?.some((s) => OFFICIAL.has(s.type))))}`);
  console.log(`Mapped line (elevation, water and towns computed from it on the trail page): ${((withLine / shown.length) * 100).toFixed(1)}%`);
  console.log(`Wikipedia description:     ${pct((r) => Boolean(r.wiki?.extract))}`);
  console.log(`Licensed photo:            ${pct((r) => Boolean(r.wiki?.image))}`);
  console.log(`Mapped trailhead/parking:  ${pct((r) => Boolean(r.trailhead && r.trailhead.kind !== "trail-end"))}`);
  const bySection: Record<string, number> = {};
  for (const r of shown) bySection[r.osm?.route ?? "official"] = (bySection[r.osm?.route ?? "official"] ?? 0) + 1;
  console.log(`By source kind:            ${JSON.stringify(bySection)}`);

  let seed = Number(process.argv.find((a) => a.startsWith("--seed="))?.slice(7) ?? 7);
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  console.log("\n10 random trails:");
  for (let i = 0; i < 10; i++) {
    const r = shown[Math.floor(rand() * shown.length)];
    const d = resolveDifficulty({ reported: r.difficulty, miles: r.miles, sacScale: r.osm?.sacScale });
    console.log(`- ${r.name} (${r.region ?? r.country}) · ${r.miles ?? "?"} mi · ${DIFFICULTY_LABELS[d.difficulty]} · score ${r.qualityScore ?? 0} · ${r.osm ? `OSM relation ${r.osm.relation}` : r.source}${r.sources?.length ? ` + ${r.sources.length} official` : ""}${r.trailhead && r.trailhead.kind !== "trail-end" ? " · trailhead" : ""}${r.wiki ? ` · Wikidata ${r.wiki.qid}` : ""}`);
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
