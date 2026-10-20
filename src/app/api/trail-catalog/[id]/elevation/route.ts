import { NextResponse } from "next/server";
import { notFound, trailParam, unavailable } from "@/lib/trip/api";
import { trailElevation } from "@/lib/trip/trail-trip";

export const runtime = "nodejs";

/** Elevation profile, gain and loss along a trail. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const t = await trailParam(context);
  if (!t) return notFound();
  try {
    const elevation = await trailElevation(t);
    if (!elevation) return NextResponse.json({ error: "This trail has no mapped line, so it has no elevation profile." }, { status: 422 });
    return NextResponse.json(elevation, { headers: { "Cache-Control": "public, max-age=604800" } });
  } catch {
    return unavailable("Elevation");
  }
}
