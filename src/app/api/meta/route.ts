import { NextResponse } from "next/server";
import { searchCatalog } from "@/lib/trail-catalog/server";

export const runtime = "nodejs";

/** Catalog size, sources, licenses, per-agency coverage and confidence counts. */
export async function GET() {
  const { manifest } = await searchCatalog({ limit: 1 });
  return NextResponse.json({
    name: "Hyked",
    trails: manifest.publicTotal ?? manifest.total,
    records: manifest.total,
    generatedAt: manifest.generatedAt,
    countries: manifest.countries,
    sources: manifest.sources,
    coverage: manifest.coverage,
    confidence: manifest.confidence,
    notes: manifest.notes,
  }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
