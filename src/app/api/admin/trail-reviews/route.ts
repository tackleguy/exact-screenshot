import { NextResponse } from "next/server";
import { adminUnauthorizedResponse, isAdminAuthorized } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase/service";
import { invalidateReviewDecisions } from "@/lib/trail-catalog/reviews";

const DECISIONS = new Set(["approve", "reject", "reverse"]);

/** Recent admin review decisions. */
export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return adminUnauthorizedResponse();
  const supabase = createServiceClient();
  if (!supabase) return NextResponse.json({ error: "Supabase service role is not configured, so reviews can't be stored." }, { status: 503 });
  const { data, error } = await supabase.from("trail_review_decisions").select("*").order("created_at", { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ decisions: data });
}

/** Approve (publish), reject (hide) or reverse (undo) a flagged trail. Body: { trailId, decision, note? }. */
export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return adminUnauthorizedResponse();
  const body = (await request.json().catch(() => null)) as { trailId?: unknown; decision?: unknown; note?: unknown } | null;
  if (!body || typeof body.trailId !== "string" || !body.trailId || body.trailId.length > 200 || typeof body.decision !== "string" || !DECISIONS.has(body.decision)) {
    return NextResponse.json({ error: "Send { trailId, decision: approve | reject | reverse, note? }." }, { status: 400 });
  }
  const supabase = createServiceClient();
  if (!supabase) return NextResponse.json({ error: "Supabase service role is not configured, so reviews can't be stored." }, { status: 503 });
  const note = typeof body.note === "string" ? body.note.slice(0, 1000) : null;
  const { data, error } = await supabase.from("trail_review_decisions").insert({ trail_id: body.trailId, decision: body.decision, note, reviewer: "admin" }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  invalidateReviewDecisions();
  return NextResponse.json({ decision: data });
}
