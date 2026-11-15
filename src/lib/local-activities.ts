/**
 * Recorded activities kept on this device (localStorage), so anyone can record a hike without an account and no
 * recording is lost when the account database can't take it. They show in the activity log like account
 * activities, and move into the account the next time a signed-in visit can save them.
 */
import type { Activity } from "@/lib/types";

const KEY = "hyked:activities";
const MAX = 40;
export const isLocalActivityId = (id: string | undefined | null) => Boolean(id?.startsWith("local-"));

export type ActivityInput = Pick<Activity, "activity_type" | "title" | "distance_m" | "duration_sec" | "elevation_gain_ft" | "route_geojson" | "started_at" | "ended_at"> & Partial<Pick<Activity, "trail_id" | "ski_area_id" | "ski_area_name" | "notes">>;

export function listLocalActivities(): Activity[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Activity[];
    return Array.isArray(list) ? list.filter((a) => a && typeof a.id === "string") : [];
  } catch { return []; }
}

function write(list: Activity[]): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
}

/** Saves an activity on this device, newest first. Returns null only when the device's storage refuses it. */
export function saveLocalActivity(input: ActivityInput, now = new Date()): Activity | null {
  const stamp = now.toISOString();
  const activity: Activity = {
    id: `local-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    user_id: "local", status: "completed",
    activity_type: input.activity_type, title: input.title || "Activity",
    distance_m: input.distance_m, duration_sec: input.duration_sec, elevation_gain_ft: input.elevation_gain_ft ?? 0,
    route_geojson: input.route_geojson ?? null,
    trail_id: input.trail_id ?? null, ski_area_id: input.ski_area_id ?? null, ski_area_name: input.ski_area_name ?? null,
    started_at: input.started_at, ended_at: input.ended_at ?? stamp, notes: input.notes ?? null,
    created_at: stamp, updated_at: stamp,
  };
  const list = [activity, ...listLocalActivities()].slice(0, MAX);
  if (write(list)) return activity;
  // Storage is full: keep the stats and drop the route lines of older activities, then of this one.
  const lighter = list.map((a, i) => (i === 0 ? a : { ...a, route_geojson: null }));
  if (write(lighter)) return activity;
  return write([{ ...activity, route_geojson: null }, ...lighter.slice(1)]) ? { ...activity, route_geojson: null } : null;
}

export const getLocalActivity = (id: string) => listLocalActivities().find((a) => a.id === id) ?? null;
export function removeLocalActivity(id: string) { write(listLocalActivities().filter((a) => a.id !== id)); }

/** The fields an account insert takes, from a device activity. */
export function toAccountRow(a: Activity, userId: string) {
  return {
    user_id: userId, status: "completed", activity_type: a.activity_type, title: a.title, distance_m: a.distance_m, duration_sec: a.duration_sec,
    elevation_gain_ft: a.elevation_gain_ft, route_geojson: a.route_geojson, started_at: a.started_at, ended_at: a.ended_at,
    trail_id: a.trail_id, ski_area_id: a.ski_area_id, ski_area_name: a.ski_area_name, notes: a.notes,
  };
}
