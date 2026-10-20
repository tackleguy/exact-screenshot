import { NextResponse } from "next/server";
import { trailElevation, trailForTrip, trailTowns, trailWater, type TrailForTrip } from "./trail-trip";
import { planTownDays, type TownDayOptions } from "./town-days";
import { tripGpx, tripPacketHtml, waterCsv, type PackItem, type TripBundle } from "./packet";
import { Route, MILE_METERS, round } from "@/lib/geo/line";
import { siteUrl } from "@/lib/site-url";

export const notFound = () => NextResponse.json({ error: "This trail was not found." }, { status: 404 });
export const unavailable = (what: string) => NextResponse.json({ error: `${what} could not be loaded right now. Try again shortly.` }, { status: 503 });

/** Route params can arrive percent-encoded (USGS ids contain braces). */
export async function trailParam(context: { params: Promise<{ id: string }> }) {
  const raw = (await context.params).id;
  let id = raw;
  try { id = decodeURIComponent(raw); } catch { /* keep raw */ }
  return trailForTrip(id);
}

const num = (v: unknown, min: number, max: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

/** Town-day options from query params or a JSON body. `days` is required to make a plan. */
export function townDayOptions(input: Record<string, unknown>): Omit<TownDayOptions, "trailMiles"> | null {
  const days = num(input.days, 1, 365);
  if (days === undefined) return null;
  const startDate = typeof input.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.startDate) ? input.startDate : null;
  return {
    days,
    foodLbPerDay: num(input.foodLbPerDay, 0.5, 4),
    maxCarryDays: num(input.maxCarryDays, 1, 14),
    maxMilesOffTrail: num(input.maxMilesOffTrail, 1, 40),
    zeroDays: input.zeroDays === true || input.zeroDays === "true",
    startDate,
    consumables: Array.isArray(input.consumables) ? input.consumables.filter((c): c is string => typeof c === "string").slice(0, 20) : undefined,
  };
}

/**
 * Share of the stated length that is mapped. Town positions are measured along the mapped line, so a
 * route that is mostly unmapped (e.g. a through-hike with few mapped sections) can't be planned.
 */
export function mappedShare(t: TrailForTrip) {
  if (!t.lines.length || !t.trail.miles) return t.lines.length ? 1 : 0;
  return new Route(t.lines).meters / MILE_METERS / t.trail.miles;
}
export const MIN_MAPPED_SHARE = 0.6;
export const unplannable = (t: TrailForTrip) =>
  `Only ${Math.round(mappedShare(t) * 100)}% of ${t.trail.name} is mapped, so town stops can't be placed along it. Plan resupply from the official trail guide.`;

/** Miles used for planning: the mapped line (which town positions are measured on), else the stated length. */
export const planningMiles = (t: TrailForTrip) => (t.lines.length ? round(new Route(t.lines).meters / MILE_METERS, 1) : t.trail.miles ?? 0);

export function cleanPack(raw: unknown): PackItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 300).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const i = item as Record<string, unknown>;
    const name = typeof i.name === "string" ? i.name.trim().slice(0, 120) : "";
    if (!name) return [];
    return [{
      name,
      quantity: num(i.quantity, 1, 999) ?? 1,
      weightOz: num(i.weightOz, 0, 10_000) ?? null,
      category: typeof i.category === "string" ? i.category.slice(0, 40) : null,
      consumable: i.consumable === true,
    }];
  });
}

export async function tripBundle(t: TrailForTrip, options: Omit<TownDayOptions, "trailMiles"> | null, pack: PackItem[]): Promise<TripBundle> {
  const [water, towns, elevation] = await Promise.all([
    trailWater(t).catch(() => null),
    trailTowns(t, options?.maxMilesOffTrail ?? 15).catch(() => []),
    trailElevation(t).catch(() => null),
  ]);
  const consumables = [...(options?.consumables ?? []), ...pack.filter((i) => i.consumable).map((i) => i.name)];
  const plan = options && t.lines.length && mappedShare(t) >= MIN_MAPPED_SHARE ? planTownDays(towns, { ...options, consumables, trailMiles: planningMiles(t) }) : null;
  return { trail: t.trail, lines: t.lines as [number, number][][], water, towns, elevation, plan, pack, siteUrl: siteUrl(), generatedAt: new Date().toISOString() };
}

const slug = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "trail";

/** A bundle in the requested format, as a download. */
export function bundleResponse(bundle: TripBundle, format: string) {
  const base = `hyked-${slug(bundle.trail.name)}`;
  const file = (body: string, type: string, ext: string, inline = false) =>
    new Response(body, { headers: { "Content-Type": `${type}; charset=utf-8`, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${base}.${ext}"`, "Cache-Control": "no-store" } });
  switch (format) {
    case "gpx": return file(tripGpx(bundle), "application/gpx+xml", "gpx");
    case "csv": return file(waterCsv(bundle), "text/csv", "water.csv");
    case "html": return file(tripPacketHtml(bundle), "text/html", "html", true);
    case "json": return NextResponse.json(bundle, { headers: { "Content-Disposition": `attachment; filename="${base}.json"` } });
    default: return NextResponse.json({ error: "format must be gpx, csv, html or json" }, { status: 400 });
  }
}
