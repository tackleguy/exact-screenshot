import { createServiceClient } from "@/lib/supabase/service";

export type ReviewDecision = "approve" | "reject";
const TTL = 60_000;
let cache: { at: number; value: Promise<Map<string, ReviewDecision>> } | null = null;

/**
 * Latest admin decision per trail (Supabase trail_review_decisions). "approve" publishes a flagged trail,
 * "reject" hides one, "reverse" clears earlier decisions. Without Supabase there are no overrides.
 */
export function reviewDecisions(): Promise<Map<string, ReviewDecision>> {
  if (cache && Date.now() - cache.at < TTL) return cache.value;
  const value = (async () => {
    const supabase = createServiceClient();
    const out = new Map<string, ReviewDecision>();
    if (!supabase) return out;
    const { data, error } = await supabase.from("trail_review_decisions").select("trail_id, decision, created_at").order("created_at", { ascending: true }).limit(50_000);
    if (error) return out;
    for (const row of data ?? []) {
      if (row.decision === "reverse") out.delete(row.trail_id);
      else out.set(row.trail_id, row.decision as ReviewDecision);
    }
    return out;
  })().catch(() => new Map<string, ReviewDecision>());
  cache = { at: Date.now(), value };
  return value;
}

export function invalidateReviewDecisions() {
  cache = null;
}
