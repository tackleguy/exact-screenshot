import type { SupabaseClient } from "@supabase/supabase-js";
import { emptyMemory, parseMemory } from "@/lib/assistant/memory";
import type { PlannerMemory } from "@/lib/assistant/types";
import { gearToRow, planToRow, profileIsEmpty } from "./planner-cloud";
import type { GuestSavedRoute, GuestState } from "./guest";

/**
 * Data earlier versions of Hyked kept on the device (localStorage), moved into the account on the first sign-in
 * and then deleted from the device:
 *   outdoor-os:planner:v1:<guest | user id>   planner preferences, gear additions and saved trips
 *   hyked-connected-route                     the last point-to-point route joined on the map
 */
export const LEGACY_PLANNER_PREFIX = "outdoor-os:planner:v1:";
export const LEGACY_ROUTE_KEY = "hyked-connected-route";

type KeyStore = { length: number; key(index: number): string | null; getItem(key: string): string | null; removeItem(key: string): void };

export interface LegacyData { keys: string[]; planner: PlannerMemory; route: GuestSavedRoute | null }

/** Combine two planner memories: preferences from `primary` where set, gear and trips de-duplicated by id. */
export function mergeMemories(primary: PlannerMemory, secondary: PlannerMemory): PlannerMemory {
  const pick = <K extends keyof PlannerMemory["profile"]>(k: K) => {
    const a = primary.profile[k], b = secondary.profile[k];
    return (a === null || a === "" || (k === "experience" && a === "some") ? b : a) as PlannerMemory["profile"][K];
  };
  const profile = { usualMilesPerDay: pick("usualMilesPerDay"), comfortablePackLb: pick("comfortablePackLb"), packCapacityL: pick("packCapacityL"), experience: pick("experience"), priorities: pick("priorities") };
  const gear = [...new Map([...secondary.gear, ...primary.gear].map(g => [g.id, g])).values()];
  const plans = [...new Map([...secondary.plans, ...primary.plans].map(p => [p.id, p])).values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt)).slice(0, 30);
  return { version: 1, profile, gear, plans };
}

function parseRoute(raw: string | null): GuestSavedRoute | null {
  if (!raw) return null;
  try {
    // Shape written by the map's "Connect trails" panel: { trails: [{ id, name, lines }], start, finish, route: { coordinates, meters } }
    const v = JSON.parse(raw) as { trails?: unknown; route?: { coordinates?: unknown; meters?: unknown } };
    const geometry = (Array.isArray(v.route?.coordinates) ? v.route.coordinates : [])
      .filter((p: unknown): p is [number, number] => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map(p => [Number(p[0]), Number(p[1])] as [number, number]);
    const meters = Number(v.route?.meters);
    if (geometry.length < 2 || !Number.isFinite(meters) || meters <= 0) return null;
    const trails = (Array.isArray(v.trails) ? v.trails : []).filter((t): t is { id: string; name?: unknown } => Boolean(t && typeof t === "object" && typeof (t as { id?: unknown }).id === "string"));
    const names = trails.map(t => typeof t.name === "string" ? t.name : "").filter(Boolean);
    return { name: (names.length ? names.join(" → ") : "Connected route").slice(0, 200), meters, geometry, trailIds: trails.map(t => t.id).slice(0, 200) };
  } catch { return null; }
}

/** Everything left on this device by earlier versions for the guest and for `userId` (other accounts are left alone). */
export function readLegacyData(storage: KeyStore, userId: string): LegacyData {
  const keys: string[] = [];
  let planner = emptyMemory();
  for (const suffix of [userId, "guest"]) {
    const key = LEGACY_PLANNER_PREFIX + suffix;
    const raw = storage.getItem(key);
    if (raw === null) continue;
    keys.push(key);
    planner = mergeMemories(planner, parseMemory(raw));
  }
  const rawRoute = storage.getItem(LEGACY_ROUTE_KEY);
  if (rawRoute !== null) keys.push(LEGACY_ROUTE_KEY);
  return { keys, planner, route: parseRoute(rawRoute) };
}

/** The rows a planner memory and saved routes become in the account. */
export function cloudRows(planner: PlannerMemory, routes: GuestSavedRoute[], userId: string) {
  return {
    preferences: profileIsEmpty(planner.profile) ? null : { user_id: userId, planner_profile: planner.profile },
    gear: planner.gear.map(g => gearToRow(g, userId)),
    trips: planner.plans.map(p => planToRow(p, userId)),
    routes: routes.map(r => ({ user_id: userId, name: r.name, meters: r.meters, geometry: r.geometry, trail_ids: r.trailIds })),
  };
}

async function must(result: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await result;
  if (error) throw new Error(error.message);
}

/** Write a guest's or legacy data into the account. Existing account preferences are kept unless empty. */
export async function uploadToAccount(client: SupabaseClient, userId: string, planner: PlannerMemory, routes: GuestSavedRoute[]) {
  const rows = cloudRows(planner, routes, userId);
  if (rows.preferences) {
    const { data } = await client.from("user_preferences").select("planner_profile").eq("user_id", userId).maybeSingle();
    const current = parseMemory(JSON.stringify({ version: 1, profile: data?.planner_profile ?? {}, gear: [], plans: [] })).profile;
    if (profileIsEmpty(current)) await must(client.from("user_preferences").upsert(rows.preferences));
  }
  if (rows.gear.length) await must(client.from("gear_items").upsert(rows.gear, { onConflict: "id", ignoreDuplicates: true }));
  if (rows.trips.length) await must(client.from("trips").upsert(rows.trips, { onConflict: "user_id,client_id", ignoreDuplicates: true }));
  if (rows.routes.length) await must(client.from("saved_routes").insert(rows.routes));
}

/** Move a guest session's personal trails into the account (same ids, so links keep working). */
export async function uploadGuestTrails(client: SupabaseClient, userId: string, guestState: GuestState, photos: Map<string, File>, upload: (id: string, photo: File) => Promise<string>) {
  for (const raw of guestState.personalTrails.values()) {
    const t = raw as { id: string; name: string; notes: string; geometry: unknown; stats: unknown; trails: unknown; features: unknown; days: unknown; waypoints: unknown };
    const photo = photos.get(t.id);
    const photo_path = photo ? await upload(t.id, photo).catch(() => null) : null;
    await must(client.from("personal_trails").upsert({ id: t.id, user_id: userId, name: t.name || "My trail", notes: t.notes ?? "", geometry: t.geometry ?? [], stats: t.stats ?? {}, trails: t.trails ?? [], features: t.features ?? [], days: t.days ?? null, waypoints: t.waypoints ?? [], ...(photo_path ? { photo_path } : {}) }, { onConflict: "id", ignoreDuplicates: true }));
  }
}

/** First sign-in on a device: move legacy localStorage data to the account, then remove it from the device. */
export async function migrateLegacyData(client: SupabaseClient, userId: string, storage: KeyStore) {
  const legacy = readLegacyData(storage, userId);
  if (!legacy.keys.length) return 0;
  await uploadToAccount(client, userId, legacy.planner, legacy.route ? [legacy.route] : []);
  await must(client.from("user_preferences").upsert({ user_id: userId, local_data_migrated_at: new Date().toISOString() }, { onConflict: "user_id" }));
  for (const key of legacy.keys) storage.removeItem(key);
  return legacy.planner.gear.length + legacy.planner.plans.length + (legacy.route ? 1 : 0);
}
