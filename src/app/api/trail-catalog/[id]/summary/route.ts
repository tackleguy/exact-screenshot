import { NextResponse } from "next/server";
import { getCatalogTrailSummary } from "@/lib/trail-catalog/server";

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
    const summary = await getCatalogTrailSummary(decodeId(id));
    if (!summary) return NextResponse.json({ error: "This trail is not in the current source catalog." }, { status: 404 });
    return NextResponse.json(summary, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch {
    return NextResponse.json({ error: "Trail summary could not load." }, { status: 503 });
  }
}
