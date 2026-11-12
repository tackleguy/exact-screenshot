import { NextResponse } from "next/server";
import { catalogTrailFeatures, getCatalogTrail } from "@/lib/trail-catalog/server";

export const runtime = "nodejs";

function decodeId(raw: string) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const detail = await getCatalogTrail(decodeId(id));
    if (!detail) return NextResponse.json({ error: "This trail is not in the current source catalog." }, { status: 404 });
    if (!detail.lines.length) {
      return NextResponse.json(
        { error: "This trail has no mapped line, so features along it can't be measured." },
        { status: 422 },
      );
    }
    const features = await catalogTrailFeatures(detail.trail.id, detail.lines);
    if (features === null) {
      return NextResponse.json({ error: "Feature layer not bundled on this server." }, { status: 404 });
    }
    return NextResponse.json(
      { features, available: true, source: "© OpenStreetMap contributors (ODbL)" },
      { headers: { "Cache-Control": "public, max-age=3600" } },
    );
  } catch {
    return NextResponse.json({ error: "Features along this trail could not load." }, { status: 503 });
  }
}
