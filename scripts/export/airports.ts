/**
 * Airports for the route builder's flight legs: every large and medium airport with scheduled passenger service
 * and an IATA code, from OurAirports (public domain), written to public/airports.json as
 * [iata, name, city, country, lat, lng, size] rows (size "L" or "M").
 *
 *   npx tsx scripts/export/airports.ts [path/to/airports.csv]
 *
 * Without a path the CSV is downloaded from https://davidmegginson.github.io/ourairports-data/airports.csv.
 */
import { readFile, writeFile } from "node:fs/promises";

const SOURCE = "https://davidmegginson.github.io/ourairports-data/airports.csv";

/** Splits one CSV line, honouring quoted fields. */
function fields(line: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function main() {
  const csv = process.argv[2] ? await readFile(process.argv[2], "utf8") : await (await fetch(SOURCE)).text();
  const [header, ...lines] = csv.split(/\r?\n/).filter(Boolean);
  const col = Object.fromEntries(fields(header).map((name, i) => [name, i]));
  const rows: [string, string, string, string, number, number, "L" | "M"][] = [];
  for (const line of lines) {
    const f = fields(line);
    const type = f[col.type];
    if ((type !== "large_airport" && type !== "medium_airport") || f[col.scheduled_service] !== "yes" || !/^[A-Z]{3}$/.test(f[col.iata_code])) continue;
    const lat = Number(f[col.latitude_deg]), lng = Number(f[col.longitude_deg]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    rows.push([f[col.iata_code], f[col.name], f[col.municipality], f[col.iso_country], Math.round(lat * 1e4) / 1e4, Math.round(lng * 1e4) / 1e4, type === "large_airport" ? "L" : "M"]);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  await writeFile("public/airports.json", JSON.stringify({ attribution: "Airports: OurAirports (public domain)", airports: rows }));
  console.log(`${rows.length} airports (${rows.filter((r) => r[6] === "L").length} large) → public/airports.json`);
}

void main();
