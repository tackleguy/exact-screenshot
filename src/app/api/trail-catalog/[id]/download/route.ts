import { bundleResponse, notFound, townDayOptions, trailParam, tripBundle, unavailable } from "@/lib/trip/api";

export const runtime = "nodejs";

/**
 * Downloads for a trail: ?format=gpx (route + water/town waypoints), csv (water), html (printable trip
 * packet) or json (everything). Add ?days=N to include a town-day resupply plan.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const t = await trailParam(context);
  if (!t) return notFound();
  const params = Object.fromEntries(new URL(request.url).searchParams);
  try {
    return bundleResponse(await tripBundle(t, townDayOptions(params), []), params.format ?? "html");
  } catch {
    return unavailable("The download");
  }
}
