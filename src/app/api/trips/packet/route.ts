import { NextResponse } from "next/server";
import { bundleResponse, cleanPack, townDayOptions, tripBundle, unavailable } from "@/lib/trip/api";
import { trailForTrip } from "@/lib/trip/trail-trip";

export const runtime = "nodejs";

/**
 * Trip packet with your own pack list. JSON body: { trailId, format: "html"|"json"|"gpx"|"csv",
 * days?, startDate?, foodLbPerDay?, maxCarryDays?, maxMilesOffTrail?, zeroDays?, pack?: [{ name, quantity,
 * weightOz, category, consumable }] }.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.trailId !== "string") return NextResponse.json({ error: "Send a JSON body with trailId." }, { status: 400 });
  const t = await trailForTrip(body.trailId);
  if (!t) return NextResponse.json({ error: "This trail was not found." }, { status: 404 });
  try {
    return bundleResponse(await tripBundle(t, townDayOptions(body), cleanPack(body.pack)), typeof body.format === "string" ? body.format : "html");
  } catch {
    return unavailable("The trip packet");
  }
}
