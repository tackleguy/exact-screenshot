import { NextResponse } from "next/server";
import { notFound, trailParam, unavailable } from "@/lib/trip/api";
import { trailTowns } from "@/lib/trip/trail-trip";
import { TOWNS_ATTRIBUTION } from "@/lib/trip/towns";

export const runtime = "nodejs";

/** Towns near a trail with the services each offers (grocery, post office, lodging, …). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const t = await trailParam(context);
  if (!t) return notFound();
  const params = new URL(request.url).searchParams;
  const maxMilesOff = Math.min(40, Math.max(1, Number(params.get("maxMilesOff")) || 15));
  const limit = params.get("limit") ? Math.min(60, Math.max(1, Number(params.get("limit")) || 6)) : undefined;
  try {
    const towns = await trailTowns(t, maxMilesOff, limit);
    return NextResponse.json({ towns, maxMilesOff, attribution: TOWNS_ATTRIBUTION }, { headers: { "Cache-Control": "public, max-age=86400" } });
  } catch {
    return unavailable("Towns");
  }
}
