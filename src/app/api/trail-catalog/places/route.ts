import { NextRequest, NextResponse } from "next/server";
import { loadTowns } from "@/lib/trip/towns";
import { distanceKm, normalize } from "@/lib/trail-catalog/search";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const q = normalize(params.get("q") ?? "");
  if (q.length < 2) return NextResponse.json({ places: [] });
  const nearLng = Number(params.get("lng"));
  const nearLat = Number(params.get("lat"));
  const hasNear = Number.isFinite(nearLng) && Number.isFinite(nearLat);
  try {
    const places = (await loadTowns())
      .filter((t) => normalize(t.name).startsWith(q))
      .map((t) => ({ t, km: hasNear ? distanceKm(nearLat, nearLng, t.latitude, t.longitude) : 0 }))
      .sort((a, b) => a.km - b.km || (b.t.population ?? 0) - (a.t.population ?? 0))
      .slice(0, 6)
      .map(({ t }) => ({ name: t.name, region: t.state, country: t.country, lat: t.latitude, lng: t.longitude }));
    return NextResponse.json(
      { places, attribution: "GeoNames (CC BY 4.0)" },
      { headers: { "Cache-Control": "public, max-age=600" } },
    );
  } catch {
    return NextResponse.json({ error: "Places could not load." }, { status: 503 });
  }
}
