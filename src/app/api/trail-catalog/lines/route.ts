import { NextRequest, NextResponse } from "next/server";
import { exploreCatalogLines } from "@/lib/trail-catalog/server";
import { parseCatalogFilters } from "@/lib/trail-catalog/search";

export const runtime = "nodejs";

/** Trail lines in a map view (GeoJSON), simplified for `zoom`. Views wider than ~4° return no lines. */
export async function GET(request: NextRequest) {
  const filters = parseCatalogFilters(request.nextUrl.searchParams);
  const zoom = Number(request.nextUrl.searchParams.get("zoom") ?? 12);
  if (!filters.bbox || !Number.isFinite(zoom)) {
    return NextResponse.json({ error: "Lines need a map area (bbox) and zoom." }, { status: 400 });
  }
  try {
    return NextResponse.json(await exploreCatalogLines(filters, filters.bbox, Math.max(8, Math.min(18, zoom))), { headers: { "Cache-Control": "public, max-age=600" } });
  } catch {
    return NextResponse.json({ error: "Trail lines could not load. Move the map to try again." }, { status: 503 });
  }
}
