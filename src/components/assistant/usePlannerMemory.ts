"use client";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { emptyMemory } from "@/lib/assistant/memory";
import type { PlannerMemory } from "@/lib/assistant/types";
import { createClient } from "@/lib/supabase/client";
import { guest, setGuestPlanner, subscribeGuest } from "@/lib/account/guest";
import { cloudGearId, gearToRow, isUuid, memoryFromRows, planToRow, plannerDiff } from "@/lib/account/planner-cloud";
import { cloudWrite } from "@/lib/account/sync";

/**
 * Trip-planner memory (preferences, gear added in the planner, saved trips). Signed in, it is loaded from and
 * saved to the account (user_preferences, gear_items, trips); the copy here is only a cache for this page.
 * Guests keep it in memory for this visit and are asked to sign in to keep it.
 */
type Cloud = { userId: string; memory: PlannerMemory; status: "loading" | "ready" | "error"; error: string };
const EMPTY = emptyMemory();
let cloud: Cloud | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
function subscribe(listener: () => void) {
  listeners.add(listener);
  const unsubscribe = subscribeGuest(listener);
  return () => { listeners.delete(listener); unsubscribe(); };
}

/** Load (or reload, e.g. after local data was moved into the account) the signed-in planner memory. */
export async function loadCloudPlanner(userId: string, force = false) {
  if (!force && cloud?.userId === userId && cloud.status !== "error") return;
  const client = createClient();
  if (!client) return;
  cloud = { userId, memory: cloud?.userId === userId ? cloud.memory : EMPTY, status: "loading", error: "" }; notify();
  const [prefs, trips] = await Promise.all([
    client.from("user_preferences").select("planner_profile").eq("user_id", userId).maybeSingle(),
    client.from("trips").select("plan").eq("user_id", userId).order("saved_at", { ascending: false }).limit(30),
  ]);
  if (cloud?.userId !== userId) return;
  const failure = prefs.error ?? trips.error;
  cloud = failure
    ? { ...cloud, status: "error", error: "Your saved trips couldn’t load right now." }
    : { userId, memory: { ...memoryFromRows(prefs.data?.planner_profile, (trips.data ?? []).map(t => t.plan)), gear: cloud.memory.gear }, status: "ready", error: "" };
  notify();
}

export function forgetCloudPlanner() { cloud = null; notify(); }

function persist(userId: string, before: PlannerMemory, after: PlannerMemory) {
  const client = createClient();
  if (!client) return;
  const diff = plannerDiff(before, after);
  if (diff.profile) void cloudWrite(() => client.from("user_preferences").upsert({ user_id: userId, planner_profile: diff.profile }, { onConflict: "user_id" }));
  if (diff.gear.length) void cloudWrite(() => client.from("gear_items").upsert(diff.gear.map(g => gearToRow(g, userId)), { onConflict: "id" }));
  if (diff.plans.length) void cloudWrite(() => client.from("trips").upsert(diff.plans.map(p => planToRow(p, userId)), { onConflict: "user_id,client_id" }));
  if (diff.removedPlans.length) void cloudWrite(() => client.from("trips").delete().eq("user_id", userId).in("client_id", diff.removedPlans));
}

export function usePlannerMemory(userId: string | null) {
  const snapshot = useCallback(() => userId ? (cloud?.userId === userId ? cloud.memory : EMPTY) : guest.planner, [userId]);
  const memory = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  const status = useSyncExternalStore(subscribe, useCallback(() => userId ? (cloud?.userId === userId ? cloud.status : "loading") : "ready", [userId]), () => "loading" as const);
  const error = useSyncExternalStore(subscribe, useCallback(() => userId && cloud?.userId === userId ? cloud.error : "", [userId]), () => "");
  useEffect(() => { if (userId) void loadCloudPlanner(userId); }, [userId]);
  const update = useCallback((fn: (current: PlannerMemory) => PlannerMemory) => {
    if (!userId) { setGuestPlanner(fn(guest.planner)); return true; }
    if (cloud?.userId !== userId || cloud.status !== "ready") return false;
    const before = cloud.memory;
    const next = fn(before);
    // Gear gets its account id now, so later edits update the same row.
    const after = { ...next, gear: next.gear.map(g => isUuid(g.id) ? g : { ...g, id: cloudGearId(g.id) }) };
    cloud = { ...cloud, memory: after }; notify();
    persist(userId, before, after);
    return true;
  }, [userId]);
  return { memory, update, error, loading: status === "loading", cloud: Boolean(userId) };
}
