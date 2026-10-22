import { NextResponse } from "next/server";
import { trailElevation, trailForTrip, trailTowns, trailWater, type TrailForTrip } from "./trail-trip";
import { planTownDays, type TownDayOptions } from "./town-days";
import { tripGpx, tripPacketHtml, waterCsv, type PackItem, type TripBundle } from "./packet";
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

import { mappedShare, MIN_MAPPED_SHARE, planningMiles, num } from "./planning";
export { townDayOptions, mappedShare, MIN_MAPPED_SHARE, unplannable, planningMiles } from "./planning";

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
