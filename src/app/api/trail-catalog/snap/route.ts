import { NextRequest, NextResponse } from "next/server";
import { snapToCatalogTrail } from "@/lib/trail-catalog/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const tolerance = Number(params.get("tolerance") ?? 50);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "lat and lng query parameters required." }, { status: 400 });
  }
  try {
    return NextResponse.json(await snapToCatalogTrail(lat, lng, Number.isFinite(tolerance) ? tolerance : 50));
  } catch {
    return NextResponse.json({ error: "Snap-to-trail could not complete." }, { status: 503 });
  }
}
