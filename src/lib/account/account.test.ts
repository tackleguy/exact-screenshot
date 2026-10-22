import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emptyMemory } from "@/lib/assistant/memory";
import type { PlannerGear, PlannerMemory, SavedPlan } from "@/lib/assistant/types";
import { EMPTY_REQUEST } from "@/lib/assistant/planning";
import { deletePersonalTrail, getPersonalTrail, listPersonalTrails, savePersonalTrail, setPersonalTrailSharing, type PersonalTrailInput } from "@/lib/personal-trails";
import { clearGuest, guest, guestHasData, parseGuestHandoff, serializeGuest } from "./guest";
import { LEGACY_PLANNER_PREFIX, LEGACY_ROUTE_KEY, cloudRows, mergeMemories, migrateLegacyData, readLegacyData } from "./migrate";
import { cloudGearId, plannerDiff } from "./planner-cloud";
import { decodeRouteParam, encodeRouteParam, personalRouteCandidate } from "./plan-route";
import { syncLabel } from "./sync";

const UUID_A = "3f2b8c1e-5d4a-4b6f-9a1e-2c3d4e5f6a7b";
const gear = (id: string, name = "Tent"): PlannerGear => ({ id, name, category: "Shelter", type: "Base", qty: 1, weightOz: 32, packedSize: "Stuff sack", sourceUrl: null });
const plan = (id: string, savedAt: string): SavedPlan => ({ id, prompt: "3 days", request: { ...EMPTY_REQUEST, region: "Colorado", days: 3, distanceMiles: 30 }, route: null, gear: [], packedIds: [], shopping: [], savedAt, feedback: null });
const memoryWith = (patch: Partial<PlannerMemory>): PlannerMemory => ({ ...emptyMemory(), ...patch });

class MemoryStorage {
  data = new Map<string, string>();
  constructor(entries: Record<string, string>) { for (const [k, v] of Object.entries(entries)) this.data.set(k, v); }
  get length() { return this.data.size; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(k: string) { return this.data.get(k) ?? null; }
  removeItem(k: string) { this.data.delete(k); }
}

const input = (name: string): PersonalTrailInput => ({
  name, notes: "Two nights", geometry: [[-119.56, 37.73], [-119.4, 37.87]], waypoints: [],
  stats: { miles: 23.4, gainFt: 5200, lossFt: 1100, minFt: 4000, maxFt: 9900, hours: null },
  trails: [{ id: "osm-r-1", name: "John Muir Trail", fromMile: 0, toMile: 23.4 }],
  features: [{ id: "f1", type: "campsite", name: "Little Yosemite Valley", lat: 37.73, lon: -119.51, mile: 4.6, offRouteFt: 120, source: "OpenStreetMap" }],
  days: [{ day: 1, fromMile: 0, toMile: 4.6, miles: 4.6, stop: null }],
});

test("guest personal trails live in memory for the visit only", async () => {
  clearGuest();
  const saved = await savePersonalTrail(input("Happy Isles to Tuolumne"));
  assert.equal(saved.isPublic, false);
  assert.equal(saved.shareToken, null);
  assert.equal((await listPersonalTrails()).length, 1);
  assert.equal((await getPersonalTrail(saved.id))?.name, "Happy Isles to Tuolumne");
  const renamed = await savePersonalTrail({ ...input("JMT start"), id: saved.id });
  assert.equal(renamed.id, saved.id);
  assert.equal(renamed.createdAt, saved.createdAt);
  assert.equal((await listPersonalTrails()).length, 1);
  await assert.rejects(setPersonalTrailSharing(saved.id, true), /Sign in to share/);
  assert.ok(guestHasData());
  await deletePersonalTrail(saved.id);
  assert.equal((await listPersonalTrails()).length, 0);
  assert.equal(await getPersonalTrail(saved.id), null);
});

test("a guest's work survives the OAuth round trip through the handoff", async () => {
  clearGuest();
  guest.planner = memoryWith({ gear: [gear(`local:${UUID_A}`)], plans: [plan("p1", "2026-10-01T00:00:00.000Z")] });
  await savePersonalTrail(input("Loop"));
  const back = parseGuestHandoff(serializeGuest());
  assert.ok(back);
  assert.equal(back.planner.gear[0].id, `local:${UUID_A}`);
  assert.equal(back.planner.plans[0].id, "p1");
  assert.equal(back.personalTrails.size, 1);
  assert.equal(parseGuestHandoff("not json"), null);
  clearGuest();
  assert.equal(guestHasData(), false);
});

test("legacy device data maps to account rows; other accounts' data is left alone", () => {
  const user = "user-1";
  const storage = new MemoryStorage({
    [LEGACY_PLANNER_PREFIX + "guest"]: JSON.stringify(memoryWith({ gear: [gear(`local:${UUID_A}`)], plans: [plan("old", "2026-01-01T00:00:00.000Z")] })),
    [LEGACY_PLANNER_PREFIX + user]: JSON.stringify(memoryWith({ profile: { ...emptyMemory().profile, usualMilesPerDay: 9 }, plans: [plan("new", "2026-05-01T00:00:00.000Z")] })),
    [LEGACY_PLANNER_PREFIX + "someone-else"]: JSON.stringify(memoryWith({ plans: [plan("theirs", "2026-02-01T00:00:00.000Z")] })),
    [LEGACY_ROUTE_KEY]: JSON.stringify({ trails: [{ id: "a", name: "Mist Trail" }, { id: "b", name: "John Muir Trail" }], start: "a:0:a", finish: "b:0:b", route: { coordinates: [[-119.5, 37.7], [-119.4, 37.8]], meters: 5000 } }),
  });
  const legacy = readLegacyData(storage, user);
  assert.deepEqual(legacy.keys.sort(), [LEGACY_PLANNER_PREFIX + "guest", LEGACY_PLANNER_PREFIX + user, LEGACY_ROUTE_KEY].sort());
  assert.deepEqual(legacy.planner.plans.map(p => p.id), ["new", "old"]);
  assert.equal(legacy.planner.profile.usualMilesPerDay, 9);
  assert.equal(legacy.route?.name, "Mist Trail → John Muir Trail");
  const rows = cloudRows(legacy.planner, legacy.route ? [legacy.route] : [], user);
  assert.equal(rows.gear[0].id, UUID_A);
  assert.equal(rows.gear[0].weight, 32);
  assert.equal(rows.gear[0].product_details.packedSize, "Stuff sack");
  assert.deepEqual(rows.trips.map(t => t.client_id), ["new", "old"]);
  assert.equal(rows.trips[0].user_id, user);
  assert.deepEqual(rows.preferences?.planner_profile.usualMilesPerDay, 9);
  assert.deepEqual(rows.routes[0], { user_id: user, name: "Mist Trail → John Muir Trail", meters: 5000, geometry: [[-119.5, 37.7], [-119.4, 37.8]], trail_ids: ["a", "b"] });
  assert.equal(cloudRows(emptyMemory(), [], user).preferences, null);
});

function fakeClient(failOn?: string) {
  const calls: { table: string; op: string; rows: unknown }[] = [];
  const builder = (table: string) => {
    const result = (op: string, rows: unknown) => { calls.push({ table, op, rows }); return Promise.resolve({ data: null, error: failOn === table ? { message: "boom" } : null }); };
    return {
      upsert: (rows: unknown) => result("upsert", rows),
      insert: (rows: unknown) => result("insert", rows),
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    };
  };
  return { calls, client: { from: builder } as unknown as SupabaseClient };
}

test("first sign-in moves device data to the account, then clears it from the device", async () => {
  const user = "user-2";
  const legacyKey = LEGACY_PLANNER_PREFIX + "guest";
  const storage = new MemoryStorage({ [legacyKey]: JSON.stringify(memoryWith({ gear: [gear(UUID_A)], plans: [plan("p", "2026-03-01T00:00:00.000Z")] })), unrelated: "keep" });
  const { client, calls } = fakeClient();
  assert.equal(await migrateLegacyData(client, user, storage), 2);
  assert.deepEqual(calls.map(c => `${c.table}:${c.op}`), ["gear_items:upsert", "trips:upsert", "user_preferences:upsert"]);
  assert.equal(storage.getItem(legacyKey), null);
  assert.equal(storage.getItem("unrelated"), "keep");
  assert.equal(await migrateLegacyData(client, user, storage), 0);

  const failing = new MemoryStorage({ [legacyKey]: JSON.stringify(memoryWith({ plans: [plan("p", "2026-03-01T00:00:00.000Z")] })) });
  await assert.rejects(migrateLegacyData(fakeClient("trips").client, user, failing), /boom/);
  assert.notEqual(failing.getItem(legacyKey), null, "data stays on the device until it reaches the account");
});

test("planner changes become the account writes they need", () => {
  const before = memoryWith({ gear: [gear(UUID_A)], plans: [plan("a", "2026-01-01T00:00:00.000Z"), plan("b", "2026-01-02T00:00:00.000Z")] });
  const after = { ...before, profile: { ...before.profile, priorities: "Quiet trails" }, plans: [{ ...before.plans[0], prompt: "changed" }] };
  const diff = plannerDiff(before, after);
  assert.equal(diff.profile?.priorities, "Quiet trails");
  assert.deepEqual(diff.gear, []);
  assert.deepEqual(diff.plans.map(p => p.id), ["a"]);
  assert.deepEqual(diff.removedPlans, ["b"]);
  assert.equal(cloudGearId(`local:${UUID_A}`), UUID_A);
  assert.match(cloudGearId("tent"), /^[0-9a-f-]{36}$/);
  const merged = mergeMemories(memoryWith({ gear: [gear("x", "New")] }), memoryWith({ gear: [gear("x", "Old"), gear("y")] }));
  assert.deepEqual(merged.gear.map(g => `${g.id}:${g.name}`).sort(), ["x:New", "y:Tent"]);
});

test("planner routes from personal trails and encoded route links", () => {
  const encoded = encodeRouteParam({ name: "Crête des Aiguilles", miles: 12.34, gainFt: 3000, days: 2 });
  const decoded = decodeRouteParam(encoded);
  assert.equal(decoded?.route.name, "Crête des Aiguilles");
  assert.equal(decoded?.route.distanceMiles, 12.3);
  assert.equal(decoded?.days, 2);
  assert.equal(decodeRouteParam(encodeRouteParam({ name: "X", miles: 5, gainFt: null }))?.route.elevationFt, null);
  assert.equal(decodeRouteParam("%%%"), null);
  const candidate = personalRouteCandidate({ ...input("JMT start"), id: UUID_A, photoUrl: null, isPublic: false, shareToken: null, createdAt: "", updatedAt: "" });
  assert.equal(candidate.id, `personal:${UUID_A}`);
  assert.equal(candidate.distanceMiles, 23.4);
  assert.equal(candidate.region, "Along John Muir Trail");
});

test("sync status labels", () => {
  const now = Date.UTC(2026, 9, 21, 12);
  assert.equal(syncLabel({ state: "guest", lastSyncedAt: null, pending: 0, message: "" }, now), "Guest · not saved");
  assert.equal(syncLabel({ state: "synced", lastSyncedAt: now - 10_000, pending: 0, message: "" }, now), "Synced · just now");
  assert.equal(syncLabel({ state: "synced", lastSyncedAt: now - 5 * 60_000, pending: 0, message: "" }, now), "Synced · 5 min ago");
  assert.equal(syncLabel({ state: "offline", lastSyncedAt: null, pending: 2, message: "" }, now), "Offline — changes will sync");
});
