import { getAuthUser } from "@/lib/supabase/server";
import { getTrails } from "@/lib/data";
import { rowToGear } from "@/lib/account/planner-cloud";
import { REFERENCE_ROUTES } from "./catalog";
import type { PlannerContext } from "./types";
export async function getPlannerContext(): Promise<PlannerContext> {
  const { user, supabase } = await getAuthUser();
  const trails = await getTrails().catch(() => []);
  const context: PlannerContext = { userId: user?.id ?? null, gear: [], activities: [], messages: [], routes: [...trails.map(t => ({ id: t.id, trailId: t.id, name: t.trail_name, region: t.park ? `${t.park.park_name}, ${t.park.state}, ${t.park.country}` : t.description, distanceMiles: t.length_miles, elevationFt: t.elevation_ft, difficulty: t.difficulty, sourceUrl: t.official_source ?? null, sourceLabel: t.official_source ? "Trail catalog source" : "Trail catalog", catalogHref: `/explore/trails/${t.id}`, note: "Confirm current access, overnight camping rules, and conditions with the land manager." })), ...REFERENCE_ROUTES] };
  if (!user || !supabase) return context;
  // Identity comes exclusively from the verified server session, never request input.
  const [gear, history, custom] = await Promise.all([
    supabase.from("gear_items").select("*").eq("user_id", user.id).order("created_at").limit(500),
    supabase.from("activities").select("id,title,distance_m,duration_sec,started_at").eq("user_id", user.id).eq("status", "completed").eq("activity_type", "hike").order("started_at", { ascending: false }).limit(40),
    supabase.from("user_trails").select("id,name,location,distance,elevation,difficulty").eq("user_id", user.id).limit(100),
  ]);
  if (gear.error) context.messages.push("Your account gear could not be loaded. Refresh to try again.");
  else context.gear = (gear.data ?? []).map(rowToGear);
  if (history.error) context.messages.push("Your activity history could not be loaded. You can still enter preferences below.");
  else context.activities = (history.data ?? []).map(a => ({ id: a.id, title: a.title, miles: Number(a.distance_m)/1609.344, hours: Number(a.duration_sec)/3600, date: a.started_at }));
  if (custom.error) context.messages.push("Your custom routes could not be loaded.");
  else context.routes.push(...(custom.data ?? []).map(t => ({ id: `custom:${t.id}`, name: t.name, region: t.location, distanceMiles: Number(t.distance), elevationFt: Number(t.elevation), difficulty: t.difficulty, sourceUrl: null, sourceLabel: "Your custom route", note: "Your saved route. Confirm current conditions and access before travel." })));
  return context;
}
