import { NextResponse } from "next/server";
import { nearbyCatalogTrails } from "@/lib/trail-catalog/server";

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
    const trails = await nearbyCatalogTrails(decodeId(id));
    if (!trails) return NextResponse.json({ error: "This trail was not found." }, { status: 404 });
    return NextResponse.json({ trails }, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch {
    return NextResponse.json({ error: "Nearby trails could not load." }, { status: 503 });
  }
}
