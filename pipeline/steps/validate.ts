/**
 * Validation report for the current catalog snapshot: coverage of names, OSM relations, official sources,
 * lines (elevation, water and towns are computed from the line when a trail page opens), Wikipedia, photos and
 * trailheads, plus 10 random trails with their key fields.
 * npx tsx pipeline/steps/validate.ts [--seed=7]
 */
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import type { CatalogTrail } from "../../src/lib/trail-catalog/types";
import { resolveDifficulty, DIFFICULTY_LABELS } from "../../src/lib/trail-difficulty";
import { trailSacScale } from "../../src/lib/trail-catalog/types";
import { PEAK_DEFINITIONS } from "../../src/lib/trail-catalog/peaks";
import { elevations } from "../../src/lib/geo/tiles";

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
  const tier = (t: string) => shown.filter((r) => r.tier === t).length;
  console.log(`Trails shown:              ${shown.length.toLocaleString("en-US")} = ${tier("verified").toLocaleString("en-US")} verified + ${tier("mapped").toLocaleString("en-US")} mapped${shown.length - tier("verified") - tier("mapped") ? ` + ${(shown.length - tier("verified") - tier("mapped")).toLocaleString("en-US")} curated/resort` : ""} (${rows.filter((r) => r.mergedInto).length.toLocaleString("en-US")} records merged into whole trails)`);
  const bySource: Record<string, number> = {};
  for (const r of shown) { const k = r.source === "osm" ? (r.osm ? "OSM route relation" : "OSM named ways") : r.sourceType ?? r.source; bySource[k] = (bySource[k] ?? 0) + 1; }
  console.log(`By source:                 ${Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toLocaleString("en-US")}`).join(" · ")}`);
  try {
    const report = JSON.parse(await readFile(path.join(dir, "build-report.json"), "utf8")) as { rejected: Record<string, Record<string, number>>; rules: Record<string, string> };
    console.log("Rejected by rule:");
    for (const [rule, bySrc] of Object.entries(report.rejected)) console.log(`  ${rule.padEnd(18)} ${String(Object.values(bySrc).reduce((a, b) => a + b, 0).toLocaleString("en-US")).padStart(9)}  ${Object.entries(bySrc).map(([k, v]) => `${k} ${v.toLocaleString("en-US")}`).join(", ")}`);
  } catch { console.log("No build-report.json in this snapshot (built before the verification filter)."); }
  try {
    const features = JSON.parse(await readFile(path.join(dir, "features-report.json"), "utf8")) as { total: number; trailLinks: number; byType: Record<string, number>; bytes: number };
    console.log(`Hike features:             ${features.total.toLocaleString("en-US")} on or near trails (${features.trailLinks.toLocaleString("en-US")} trail–feature links, ${(features.bytes / 1e6).toFixed(1)} MB)`);
    console.log(`  by type:                 ${Object.entries(features.byType).map(([k, v]) => `${k} ${v.toLocaleString("en-US")}`).join(" · ")}`);
  } catch { console.log("No features-report.json yet (run pipeline/steps/features.ts)."); }
  console.log(`Named:                     ${pct((r) => !/^unnamed/i.test(r.name) && !r.originalName)}`);
  console.log(`OSM route relation:        ${pct((r) => Boolean(r.osm))}`);
  console.log(`Official source match:     ${pct((r) => Boolean((r.sourceType && OFFICIAL.has(r.sourceType)) || r.sources?.some((s) => OFFICIAL.has(s.type))))}`);
  console.log(`With elevation (a mapped line sampled against AWS Terrain Tiles on the trail page): ${((withLine / shown.length) * 100).toFixed(1)}%`);
  console.log(`Wikipedia description:     ${pct((r) => Boolean(r.wiki?.extract))}`);
  console.log(`Licensed photo:            ${pct((r) => Boolean(r.wiki?.image))}`);
  console.log(`Mapped trailhead/parking:  ${pct((r) => Boolean(r.trailhead && r.trailhead.kind !== "trail-end"))}`);
  const bySection: Record<string, number> = {};
  for (const r of shown) bySection[r.osm?.route ?? "official"] = (bySection[r.osm?.route ?? "official"] ?? 0) + 1;
  console.log(`By source kind:            ${JSON.stringify(bySection)}`);

  // Worldwide trails (world.ts), country by country.
  try {
    const world = JSON.parse(await readFile(path.join(dir, "world", "report.json"), "utf8")) as { world: { verified: number; mapped: number; countries: Record<string, number>; geometryBytes: number }; rejected: Record<string, Record<string, number>> };
    const top = Object.entries(world.world.countries).sort((a, b) => b[1] - a[1]);
    console.log(`Worldwide:                 ${(world.world.verified + world.world.mapped).toLocaleString("en-US")} = ${world.world.verified.toLocaleString("en-US")} verified + ${world.world.mapped.toLocaleString("en-US")} mapped in ${top.length} countries (lines ${(world.world.geometryBytes / 1e6).toFixed(0)} MB)`);
    console.log(`  most trails:             ${top.slice(0, 12).map(([c, n]) => `${c} ${n.toLocaleString("en-US")}`).join(" · ")}`);
    console.log(`  rejected by rule:        ${Object.entries(world.rejected).map(([r, bySrc]) => `${r} ${Object.values(bySrc).reduce((a, b) => a + b, 0).toLocaleString("en-US")}`).join(" · ")}`);
  } catch { console.log("Worldwide:                 not in this snapshot (npm run pipeline -- --world)"); }

  let seed = Number(process.argv.find((a) => a.startsWith("--seed="))?.slice(7) ?? 7);
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  console.log("\n10 random trails:");
  for (let i = 0; i < 10; i++) {
    const r = shown[Math.floor(rand() * shown.length)];
    const d = resolveDifficulty({ reported: r.difficulty, miles: r.miles, sacScale: trailSacScale(r) });
    console.log(`- ${r.name} (${r.region ?? r.country}) · ${r.miles ?? "?"} mi · ${DIFFICULTY_LABELS[d.difficulty]} · score ${r.qualityScore ?? 0} · ${r.osm ? `OSM relation ${r.osm.relation}` : r.source}${r.sources?.length ? ` + ${r.sources.length} official` : ""}${r.trailhead && r.trailhead.kind !== "trail-end" ? " · trailhead" : ""}${r.wiki ? ` · Wikidata ${r.wiki.qid}` : ""}`);
  }
}
main()
  .then(elevationCheck)
  .catch((e) => { console.error(e); process.exitCode = 1; });

/**
 * DEM sanity check: the elevation tiles sampled at every U.S. 14er summit against its known summit elevation.
 * Terrarium at zoom 13 is ~15 m per pixel, so summits read a little low (the pixel averages the slopes around them).
 */
async function elevationCheck() {
  const peaks = PEAK_DEFINITIONS.filter((p) => p.category === "14er");
  const meters = await elevations(peaks.map((p) => [p.longitude, p.latitude] as [number, number]));
  const diffs = peaks.map((p, i) => ({ name: p.name, known: p.summitElevationFt, dem: Math.round(meters[i] * 3.28084) })).filter((d) => Number.isFinite(d.dem));
  const errors = diffs.map((d) => Math.abs(d.dem - d.known));
  const mean = errors.reduce((a, b) => a + b, 0) / Math.max(1, errors.length);
  console.log(`\nElevation check (${diffs.length} 14er summits): mean difference ${Math.round(mean)} ft, worst ${Math.max(...errors)} ft (${diffs[errors.indexOf(Math.max(...errors))]?.name}).`);
  for (const d of diffs.slice(0, 5)) console.log(`  ${d.name}: known ${d.known.toLocaleString("en-US")} ft, DEM ${d.dem.toLocaleString("en-US")} ft`);
}

