import { NextRequest, NextResponse } from "next/server";
import { exploreCatalogPoints } from "@/lib/trail-catalog/server";
import { parseCatalogFilters } from "@/lib/trail-catalog/search";

export const runtime = "nodejs";

/** Compact trail pins for the map: [id, name, lng, lat, miles, difficulty, place, routeType], or count clusters. */
export async function GET(request: NextRequest) {
  const filters = parseCatalogFilters(request.nextUrl.searchParams);
  if (request.nextUrl.searchParams.has("bbox") && !filters.bbox) {
    return NextResponse.json({ error: "The map area is invalid. Move the map and try again." }, { status: 400 });
  }
  try {
    return NextResponse.json(await exploreCatalogPoints({ ...filters, page: undefined, limit: undefined }), { headers: { "Cache-Control": "public, max-age=300" } });
  } catch {
    return NextResponse.json({ error: "Trails could not load. Move the map to try again." }, { status: 503 });
  }
}
