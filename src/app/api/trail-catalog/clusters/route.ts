import { NextRequest, NextResponse } from "next/server";
import { exploreCatalogClusters } from "@/lib/trail-catalog/server";
import { parseCatalogFilters } from "@/lib/trail-catalog/search";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const filters = parseCatalogFilters(params);
  if (params.has("bbox") && !filters.bbox) {
    return NextResponse.json({ error: "The map area is invalid. Move the map and try again." }, { status: 400 });
  }
  const zoom = Number(params.get("zoom") ?? 4);
  try {
    return NextResponse.json(await exploreCatalogClusters(filters, Number.isFinite(zoom) ? zoom : 4), {
      headers: { "Cache-Control": "public, max-age=600" },
    });
  } catch {
    return NextResponse.json({ error: "Trail counts could not load. Move the map to try again." }, { status: 503 });
  }
}
