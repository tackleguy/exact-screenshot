import { getCatalogTrail } from "@/lib/trail-catalog/server";
import { catalogGpx } from "@/lib/trail-catalog/gpx";
export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const detail = await getCatalogTrail(id);
    if (!detail) return new Response("Trail not found", { status: 404 });
    return new Response(catalogGpx(detail.trail, detail.lines), { headers: { "Content-Type": "application/gpx+xml; charset=utf-8", "Content-Disposition": 'attachment; filename="hyked-trail.gpx"', "Cache-Control": "public, max-age=3600" } });
  } catch { return new Response("The GPX file could not be prepared. Please try again.", { status: 503 }); }
}
