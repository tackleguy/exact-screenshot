import { NextRequest, NextResponse } from "next/server";
import { catalogFeaturesInView } from "@/lib/trail-catalog/server";
import { parseCatalogFilters } from "@/lib/trail-catalog/search";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const bbox = parseCatalogFilters(params).bbox;
  const types = new Set((params.get("types") ?? "").split(",").filter(Boolean));
  try {
    const result = await catalogFeaturesInView(bbox, types);
    if (!result) return NextResponse.json({ error: "Feature layer not bundled on this server." }, { status: 404 });
    return NextResponse.json(
      { features: result.features, total: result.total, source: result.source },
      { headers: { "Cache-Control": "public, max-age=600" } },
    );
  } catch {
    return NextResponse.json({ error: "Hike features could not load." }, { status: 503 });
  }
}
