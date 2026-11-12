import { NextResponse } from "next/server";
import { catalogThruHikeLines } from "@/lib/trail-catalog/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await catalogThruHikeLines(), {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch {
    return NextResponse.json({ error: "Through-hike routes could not load." }, { status: 503 });
  }
}
