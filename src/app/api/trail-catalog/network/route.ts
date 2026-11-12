import { NextRequest, NextResponse } from "next/server";
import { catalogRoutingNetwork } from "@/lib/trail-catalog/server";
import { parseCatalogFilters } from "@/lib/trail-catalog/search";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const box = parseCatalogFilters(request.nextUrl.searchParams).bbox;
  if (!box || box[2] - box[0] > 3.2 || box[3] - box[1] > 3.2) {
    return NextResponse.json({ error: "Choose points closer together (within about 150 miles)." }, { status: 400 });
  }
  try {
    return NextResponse.json(await catalogRoutingNetwork(box), {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch {
    return NextResponse.json({ error: "Trail routing network could not load." }, { status: 503 });
  }
}
