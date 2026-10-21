/** Officially allowed uses for USGS National Digital Trails records, joined onto a built snapshot.
 * Each catalog trail gets the uses its sections allow along most of their length (hiker, bicycle,
 * pack and saddle, e-bike, motorcycle, OHV, snowshoe, cross-country ski) and a surface when it had none.
 * npx tsx scripts/ingestion/trail-uses.ts [--apply]   (dry run without --apply)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import path from "node:path";
import type { CatalogManifest, CatalogTrail } from "../../src/lib/trail-catalog/types";
import { trailSections } from "../../src/lib/trail-catalog/sections";

const USGS = "https://carto.nationalmap.gov/arcgis/rest/services/transportation/MapServer/37/query";
const WHERE = "(name IS NOT NULL AND name <> '') OR hikerpedestrian = 'Y'";
const USE_FIELDS: Record<string, string> = {
  hikerpedestrian: "Hiking", bicycle: "Bikes", packsaddle: "Horses", ebike: "E-bikes", motorcycle: "Motorcycles",
  ohvover50inches: "4WD vehicles", ohvisorunder50inches: "ATVs", snowshoe: "Snowshoeing", crosscountryski: "Cross-country skiing",
};
const FIELDS = ["objectid", "permanentidentifier", "lengthmiles", "trailsurface", "trailtype", ...Object.keys(USE_FIELDS)];
/** A use counts when sections allowing it make up at least this share of the trail's documented length. */
const MAJORITY = 0.5;

type Attrs = Record<string, string | number | null>;

async function usgsPages(): Promise<Attrs[]> {
  const dir = path.join(process.cwd(), ".cache/trail-uses");
  await mkdir(dir, { recursive: true });
  const out: Attrs[] = [];
  for (let offset = 0; ; offset += 2000) {
    const file = path.join(dir, `usgs-${offset}.json.gz`);
    let data: { features?: { attributes: Attrs }[]; exceededTransferLimit?: boolean; error?: unknown };
    try { data = JSON.parse(gunzipSync(await readFile(file)).toString()); } catch {
      const q = new URLSearchParams({ where: WHERE, outFields: FIELDS.join(","), returnGeometry: "false", orderByFields: "objectid ASC", resultOffset: String(offset), resultRecordCount: "2000", f: "json" });
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await fetch(`${USGS}?${q}`, { headers: { "User-Agent": "Hyked/1.0 (https://github.com/tackleguy/health)" }, signal: AbortSignal.timeout(120_000) });
          data = await r.json();
          if (data.error) throw new Error(JSON.stringify(data.error));
          break;
        } catch (error) {
          if (attempt >= 4) throw error;
          await new Promise((done) => setTimeout(done, 3000 * (attempt + 1)));
        }
      }
      await writeFile(file, gzipSync(JSON.stringify(data)));
    }
    for (const f of data.features ?? []) out.push(f.attributes);
    if (offset % 40_000 === 0) console.log(`  ${out.length.toLocaleString("en-US")} USGS sections`);
    if (!data.exceededTransferLimit || !(data.features ?? []).length) break;
  }
  return out;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const root = path.join(process.cwd(), "data/trail-catalog");
  const dir = path.join(root, JSON.parse(await readFile(path.join(root, "current.json"), "utf8")).directory);
  const rows = JSON.parse(gunzipSync(await readFile(path.join(dir, "index.json.gz"))).toString()) as CatalogTrail[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Section id → trail id: the trail's own id, or the alias written when sections were merged.
  const alias = new Map<string, string>();
  for (let i = 0; i < 64; i++) {
    const shard = JSON.parse(gunzipSync(await readFile(path.join(dir, `aliases-${String(i).padStart(2, "0")}.json.gz`))).toString()) as Record<string, string>;
    for (const [from, to] of Object.entries(shard)) alias.set(from, to);
  }
  const sections = await usgsPages();
  console.log(`${sections.length.toLocaleString("en-US")} USGS sections with use fields`);

  type Tally = { miles: number; uses: Record<string, number>; surface: Record<string, number>; noHikers: number };
  const tallies = new Map<string, Tally>();
  for (const a of sections) {
    const sectionId = `usgs-${a.permanentidentifier}`;
    let id = byId.has(sectionId) ? sectionId : alias.get(sectionId);
    for (let hops = 0; id && !byId.has(id) && hops < 4; hops++) id = alias.get(id);
    if (!id || !byId.has(id)) continue;
    const miles = Math.max(0.01, Number(a.lengthmiles) || 0.01);
    const t = tallies.get(id) ?? { miles: 0, uses: {}, surface: {}, noHikers: 0 };
    t.miles += miles;
    for (const [field, label] of Object.entries(USE_FIELDS)) if (a[field] === "Y") t.uses[label] = (t.uses[label] ?? 0) + miles;
    if (a.hikerpedestrian === "N") t.noHikers += miles;
    const surface = typeof a.trailsurface === "string" ? a.trailsurface.trim() : "";
    if (surface && !/^(unknown|other)$/i.test(surface)) t.surface[surface] = (t.surface[surface] ?? 0) + miles;
    tallies.set(id, t);
  }

  let withUses = 0, surfaced = 0, noHiking = 0, motorized = 0;
  const before = new Map(rows.map((r) => [r.id, trailSections(r).join(",")]));
  for (const [id, t] of tallies) {
    const row = byId.get(id)!;
    const uses = Object.entries(t.uses).filter(([, m]) => m / t.miles >= MAJORITY).map(([u]) => u);
    // Agency records (USFS, BLM) already carry their own official uses; USGS fills the rest.
    if (uses.length && !row.uses?.length) { row.uses = uses; withUses++; }
    // USGS says hikers are not allowed on most of the trail: keep it out of foot sections.
    if (t.noHikers / t.miles >= MAJORITY && !(row.uses ?? []).includes("Hiking") && !row.flags?.includes("no-hiking")) { row.flags = [...(row.flags ?? []), "no-hiking"]; noHiking++; }
    // Only motor vehicles allowed: an OHV route, not a hike or ride.
    if (uses.length && uses.every((u) => /^(Motorcycles|ATVs|4WD vehicles)$/.test(u)) && !row.flags?.includes("motorized")) { row.flags = [...(row.flags ?? []), "motorized"]; motorized++; }
    const top = Object.entries(t.surface).sort((x, y) => y[1] - x[1])[0];
    if (!row.surface && top && top[1] / t.miles >= MAJORITY) { row.surface = top[0]; surfaced++; }
  }
  const moved: Record<string, number> = {};
  for (const r of rows) {
    const after = trailSections(r).join(",");
    if (after !== before.get(r.id)) moved[`${before.get(r.id) || "-"} → ${after || "-"}`] = (moved[`${before.get(r.id) || "-"} → ${after || "-"}`] ?? 0) + 1;
  }
  console.log(`${withUses.toLocaleString("en-US")} trails got official uses; ${surfaced.toLocaleString("en-US")} got a surface; ${noHiking} are closed to hikers; ${motorized} are motor-vehicle only.`);
  console.log("Section changes:", Object.entries(moved).sort((a, b) => b[1] - a[1]).slice(0, 25));
  if (!apply) { console.log("\nDry run. Re-run with --apply to write the snapshot."); return; }
  const index = gzipSync(JSON.stringify(rows), { level: 9 });
  await writeFile(path.join(dir, "index.json.gz"), index);
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as CatalogManifest;
  manifest.indexSha256 = createHash("sha256").update(index).digest("hex");
  manifest.notes = [...manifest.notes.filter((n) => !n.startsWith("Allowed uses")), `Allowed uses (hiking, biking, horses, snowshoe, cross-country ski, motorized) come from the official use fields of the USGS National Digital Trails sections and the U.S. Forest Service and BLM records; a use is listed when sections allowing it make up at least half the trail. ${rows.filter((r) => r.uses?.length).length.toLocaleString("en-US")} trails have official uses; the rest are sorted by name and surface. Trails USGS records as closed to hikers, or open only to motor vehicles, are kept out of foot sections.`];
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log("Applied.");
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
