import { NextResponse } from "next/server";
import { getCatalogTrail } from "@/lib/trail-catalog/server";
import { wikiPhotos } from "@/lib/trail-catalog/photos";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const detail = await getCatalogTrail(id);
    if (!detail) return NextResponse.json({ error: "Trail section not found." }, { status: 404 });
    // Only the trail's own Wikidata/Commons image; nearby geotagged photos often showed something else.
    return NextResponse.json({ photos: wikiPhotos(detail.trail) }, { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
  } catch {
    return NextResponse.json({ error: "The photo source is unavailable right now. Try again shortly." }, { status: 503 });
  }
}
