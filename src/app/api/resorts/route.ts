import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ResortTrailSource } from "@/lib/trail-catalog/resorts";
import { searchCatalog } from "@/lib/trail-catalog/server";

export const runtime = "nodejs";

/** Ski resorts with official summer trail listings, and how many of their trails Hyked lists. */
export async function GET() {
  const data = JSON.parse(await readFile(path.join(process.cwd(), "data/trail-catalog/resort-trails.json"), "utf8")) as { resorts: ResortTrailSource[] };
  const resorts = await Promise.all(data.resorts.filter((r) => r.trails.length).map(async (r) => ({
    name: r.resort,
    state: r.state,
    latitude: r.baseLatitude,
    longitude: r.baseLongitude,
    sourceUrl: r.sourceUrl,
    listedTrails: r.trails.length,
    trailsInCatalog: (await searchCatalog({ resort: r.resort, limit: 1, activity: "all" })).total,
    browse: `/api/trail-catalog?resort=${encodeURIComponent(r.resort)}&activity=all`,
  })));
  return NextResponse.json({ resorts }, { headers: { "Cache-Control": "public, max-age=86400" } });
}
