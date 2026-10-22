"use client";
import { useEffect, useMemo, useState } from "react";
import type { PlannerGear } from "@/lib/assistant/types";
import { createClient } from "@/lib/supabase/client";
import { usePlannerMemory } from "@/components/assistant/usePlannerMemory";
import { rowToGear } from "./planner-cloud";
import { useSessionUserId } from "./session";

/** Everything this person can pack: account gear when signed in (plus items added in the planner), guest gear otherwise. */
export function useMyGear(): PlannerGear[] {
  const { userId } = useSessionUserId();
  const { memory } = usePlannerMemory(userId);
  const [account, setAccount] = useState<{ userId: string; gear: PlannerGear[] } | null>(null);
  useEffect(() => {
    const client = createClient();
    if (!userId || !client) return;
    let active = true;
    void client.from("gear_items").select("*").eq("user_id", userId).order("created_at").limit(500)
      .then(({ data }) => { if (active) setAccount({ userId, gear: (data ?? []).map(rowToGear) }); });
    return () => { active = false; };
  }, [userId]);
  return useMemo(() => {
    const own = userId && account?.userId === userId ? account.gear : [];
    return [...new Map([...own, ...memory.gear].map(g => [g.id, g])).values()];
  }, [userId, account, memory.gear]);
}
