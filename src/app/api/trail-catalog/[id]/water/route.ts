import { NextResponse } from "next/server";
import { notFound, trailParam, unavailable } from "@/lib/trip/api";
import { trailWater } from "@/lib/trip/trail-trip";

export const runtime = "nodejs";

/** Water sources along a trail: taps, springs, stream crossings, lakes, each at its trail mile. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const t = await trailParam(context);
  if (!t) return notFound();
  try {
    const water = await trailWater(t);
    if (!water) return NextResponse.json({ error: "This trail has no mapped line, so water along it can't be listed." }, { status: 422 });
    return NextResponse.json(water, { headers: { "Cache-Control": "public, max-age=86400" } });
  } catch {
    return unavailable("Water sources");
  }
}
