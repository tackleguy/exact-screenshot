import test from "node:test";
import assert from "node:assert/strict";

// A minimal localStorage for Node, with an optional size limit to imitate a full device.
const store = new Map<string, string>();
let limit = Infinity;
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { if (v.length > limit) throw new Error("QuotaExceededError"); store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(), key: () => null, length: 0,
} as Storage;

const { getLocalActivity, isLocalActivityId, listLocalActivities, removeLocalActivity, saveLocalActivity, toAccountRow } = await import("./local-activities");
const hike = (title: string, points = 3) => ({ activity_type: "hike" as const, title, distance_m: 4200, duration_sec: 3600, elevation_gain_ft: 800, started_at: "2026-11-15T10:00:00Z", ended_at: "2026-11-15T11:00:00Z", route_geojson: { type: "LineString" as const, coordinates: Array.from({ length: points }, (_, i) => [-119.6 + i * 1e-4, 37.74] as [number, number]) } });

test("a guest's recording is kept on the device, newest first, and can be read back and removed", () => {
  store.clear(); limit = Infinity;
  const a = saveLocalActivity(hike("Morning hike"), new Date("2026-11-15T11:00:00Z"))!;
  const b = saveLocalActivity(hike("Evening hike"), new Date("2026-11-15T19:00:00Z"))!;
  assert.ok(isLocalActivityId(a.id) && a.id !== b.id);
  assert.deepEqual(listLocalActivities().map((x) => x.title), ["Evening hike", "Morning hike"]);
  assert.equal(getLocalActivity(a.id)?.distance_m, 4200);
  removeLocalActivity(a.id);
  assert.equal(getLocalActivity(a.id), null);
  assert.equal(toAccountRow(b, "user-1").user_id, "user-1");
  assert.equal("id" in toAccountRow(b, "user-1"), false, "the account assigns its own id");
});

test("when the device is nearly full the stats are still saved, without older route lines", () => {
  store.clear(); limit = Infinity;
  saveLocalActivity(hike("Old long hike", 400));
  limit = 3500;
  const saved = saveLocalActivity(hike("New hike", 20));
  assert.ok(saved, "the new activity is saved");
  const list = listLocalActivities();
  assert.equal(list.length, 2);
  assert.equal(list[1].route_geojson, null, "the older route line was dropped to make room");
  assert.equal(list[1].distance_m, 4200);
});

test("damaged storage reads as no activities instead of throwing", () => {
  store.set("hyked:activities", "{not json"); limit = Infinity;
  assert.deepEqual(listLocalActivities(), []);
});
