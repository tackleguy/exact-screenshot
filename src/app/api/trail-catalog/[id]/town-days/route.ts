import { NextResponse } from "next/server";
import { MIN_MAPPED_SHARE, mappedShare, notFound, planningMiles, townDayOptions, trailParam, unavailable, unplannable } from "@/lib/trip/api";
import { trailTowns } from "@/lib/trip/trail-trip";
import { planTownDays } from "@/lib/trip/town-days";
import { TOWNS_ATTRIBUTION } from "@/lib/trip/towns";

export const runtime = "nodejs";

async function plan(id: { params: Promise<{ id: string }> }, input: Record<string, unknown>) {
  const t = await trailParam(id);
  if (!t) return notFound();
  const options = townDayOptions(input);
  if (!options) return NextResponse.json({ error: "Give the number of hiking days, e.g. ?days=5." }, { status: 400 });
  if (!t.lines.length) return NextResponse.json({ error: "This trail has no mapped line, so town stops can't be placed along it." }, { status: 422 });
  if (mappedShare(t) < MIN_MAPPED_SHARE) return NextResponse.json({ error: unplannable(t) }, { status: 422 });
  try {
    const towns = await trailTowns(t, options.maxMilesOffTrail ?? 15);
    const result = planTownDays(towns, { ...options, trailMiles: planningMiles(t) });
    return NextResponse.json({ trailId: t.trail.id, trailMiles: planningMiles(t), ...result, attribution: TOWNS_ATTRIBUTION });
  } catch {
    return unavailable("Town days");
  }
}

/** Resupply plan: which town on which day, and what to buy and do there. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return plan(context, Object.fromEntries(new URL(request.url).searchParams));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Send a JSON body with days." }, { status: 400 });
  return plan(context, body as Record<string, unknown>);
}
