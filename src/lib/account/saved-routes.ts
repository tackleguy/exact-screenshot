"use client";
import { createClient } from "@/lib/supabase/client";
import { noteGuestProgress } from "@/components/nav/GuestSaveBanner";
import { guest, guestChanged, type GuestSavedRoute } from "./guest";
import { trackCloud } from "./sync";

/** Point-to-point routes joined on the map: the account's `saved_routes` when signed in, this visit's memory for guests. */
export type SavedRoute = GuestSavedRoute & { id: string; createdAt: string };

async function signedIn() {
  const client = createClient();
  const session = client ? (await client.auth.getSession()).data.session : null;
  return client && session ? { client, userId: session.user.id } : null;
}

export async function saveRoute(route: GuestSavedRoute): Promise<SavedRoute> {
  const s = await signedIn();
  if (!s) {
    guest.savedRoutes = [route, ...guest.savedRoutes].slice(0, 50); guestChanged(); noteGuestProgress();
    return { ...route, id: `guest-${guest.savedRoutes.length}`, createdAt: new Date().toISOString() };
  }
  return trackCloud(async () => {
    const { data, error } = await s.client.from("saved_routes").insert({ user_id: s.userId, name: route.name.slice(0, 200), meters: route.meters, geometry: route.geometry, trail_ids: route.trailIds }).select("id, created_at").single();
    if (error) throw new Error(error.message);
    return { ...route, id: String(data.id), createdAt: String(data.created_at) };
  });
}

export async function latestSavedRoute(): Promise<SavedRoute | null> {
  const s = await signedIn();
  if (!s) return guest.savedRoutes[0] ? { ...guest.savedRoutes[0], id: `guest-${guest.savedRoutes.length}`, createdAt: "" } : null;
  const { data, error } = await s.client.from("saved_routes").select("id, name, meters, geometry, trail_ids, created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { id: String(data.id), name: data.name, meters: Number(data.meters), geometry: data.geometry, trailIds: data.trail_ids ?? [], createdAt: data.created_at } : null;
}
