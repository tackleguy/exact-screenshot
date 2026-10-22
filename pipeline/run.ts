/**
 * Hyked trail data pipeline — one command, safe to re-run monthly:
 *
 *   npm run pipeline                    # extract OSM (cached regions skipped), Wikidata, build, validate
 *   npm run pipeline -- --refresh       # re-download every OSM region and refresh Wikidata first
 *   npm run pipeline -- --official      # also rebuild the official-agency snapshot (slow; cached pages reused)
 *   npm run pipeline -- --world         # also add every other country (streams the planet; ~3 h, ~25 GB free disk)
 *   npm run pipeline -- --mirror openstreetmap.fr --disk
 *                                       # U.S./Canada extracts from the OSM France mirror, kept on disk (for machines
 *                                       # that can't reach Geofabrik or have little memory)
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
    await rm(path.join(root, ".cache/osm-features"), { recursive: true, force: true });
    await rm(path.join(root, ".cache/world-work"), { recursive: true, force: true });
    await rm(path.join(root, ".cache/world-pbf"), { recursive: true, force: true });
    await rm(path.join(root, ".cache/world-features"), { recursive: true, force: true });
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
  const argv = process.argv.slice(2);
  const mirror = argv.includes("--mirror") ? ["--mirror", argv[argv.indexOf("--mirror") + 1]] : [];
  step("OpenStreetMap extracts (U.S. and Canada)", "python3", ["pipeline/steps/extract-osm.py", "--workers", "2", ...mirror, ...(args.has("--disk") ? ["--disk"] : [])]);
  step("Wikidata / Wikipedia", "npx", ["tsx", "pipeline/steps/wiki.ts"]);
  step("Build catalog", "npx", ["tsx", "pipeline/steps/build.ts"], { NODE_OPTIONS: "--max-old-space-size=12288" });
  if (args.has("--world")) {
    // Every other country (plus Alaska and Hawaii): the planet streamed three times, split per country, built with
    // the same rules, and added to the snapshot the build just wrote.
    step("Country and region outlines (Natural Earth)", "python3", ["pipeline/steps/places.py"]);
    step("OpenStreetMap worldwide (planet stream)", "python3", ["pipeline/steps/extract-world.py"]);
    step("Wikidata / Wikipedia worldwide", "npx", ["tsx", "pipeline/steps/wiki.ts", "--world"]);
    step("Build worldwide trails", "npx", ["tsx", "pipeline/steps/world.ts"], { NODE_OPTIONS: "--max-old-space-size=12288" });
  }
  step("Hike features along trails", "npx", ["tsx", "pipeline/steps/features.ts"], { NODE_OPTIONS: "--max-old-space-size=8192" });
  step("Validation report", "npx", ["tsx", "pipeline/steps/validate.ts"]);
  console.log("\nDone. `npm run build` turns the new snapshot into the app's sharded files, sitemap and robots.txt.");
}
main().catch((e) => { console.error(e); process.exit(1); });
