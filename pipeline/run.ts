/**
 * Hyked trail data pipeline — one command, safe to re-run monthly:
 *
 *   npm run pipeline                    # extract OSM (cached regions skipped), Wikidata, build, validate
 *   npm run pipeline -- --refresh       # re-download every OSM region and refresh Wikidata first
 *   npm run pipeline -- --official      # also rebuild the official-agency snapshot (slow; cached pages reused)
 *
 * Each step caches its inputs under .cache/, so an interrupted run resumes where it stopped.
 * See pipeline/README.md for what every step does.
 */
import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const args = new Set(process.argv.slice(2));

function step(title: string, command: string, commandArgs: string[], env: Record<string, string> = {}) {
  console.log(`\n▶ ${title}\n  ${command} ${commandArgs.join(" ")}`);
  const started = Date.now();
  const result = spawnSync(command, commandArgs, { stdio: "inherit", cwd: root, env: { ...process.env, ...env } });
  if (result.status !== 0) {
    console.error(`✖ ${title} failed (exit ${result.status}). Fix the error and run the pipeline again; finished steps are cached.`);
    process.exit(result.status ?? 1);
  }
  console.log(`✔ ${title} (${Math.round((Date.now() - started) / 1000)} s)`);
}

async function main() {
  if (args.has("--refresh")) {
    await rm(path.join(root, ".cache/osm-pbf"), { recursive: true, force: true });
    await rm(path.join(root, ".cache/wiki"), { recursive: true, force: true });
  }
  if (args.has("--official")) {
    // Official layers: USGS National Digital Trails, NPS, USFS, BLM, Parks Canada, Ontario (ArcGIS services),
    // then the allowed-use and winter passes. The result becomes the official base for the build.
    step("Official agency layers", "npx", ["tsx", "scripts/ingestion/source-catalog.ts", ...(args.has("--refresh") ? ["--refresh"] : [])]);
    step("Official allowed uses (USGS)", "npx", ["tsx", "scripts/ingestion/trail-uses.ts", "--apply"]);
    step("Winter and ski reclassification", "npx", ["tsx", "scripts/ingestion/reclassify-winter.ts", "--apply"]);
    const current = await readFile(path.join(root, "data/trail-catalog/current.json"), "utf8");
    await writeFile(path.join(root, "data/trail-catalog/official-base.json"), current);
  }
  step("OpenStreetMap extracts (Geofabrik, in memory)", "python3", ["pipeline/steps/extract-osm.py", "--workers", "2"]);
  step("Wikidata / Wikipedia", "npx", ["tsx", "pipeline/steps/wiki.ts"]);
  step("Build catalog", "npx", ["tsx", "pipeline/steps/build.ts"], { NODE_OPTIONS: "--max-old-space-size=12288" });
  step("Hike features along trails", "npx", ["tsx", "pipeline/steps/features.ts"], { NODE_OPTIONS: "--max-old-space-size=8192" });
  step("Validation report", "npx", ["tsx", "pipeline/steps/validate.ts"]);
  console.log("\nDone. `npm run build` turns the new snapshot into the app's sharded files, sitemap and robots.txt.");
}
main().catch((e) => { console.error(e); process.exit(1); });
