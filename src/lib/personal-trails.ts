"use client";
import { useCallback, useEffect, useState } from "react";
import { friendlyError } from "@/lib/errors";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { guest, guestChanged, subscribeGuest } from "@/lib/account/guest";
import { trackCloud } from "@/lib/account/sync";
import { noteGuestProgress } from "@/components/nav/GuestSaveBanner";

/**
 * Personal trails: routes built along real trails and saved with a name, notes, photo, stats and the features
 * along them. Signed in, they live in the account (Supabase `personal_trails`, photos in the private
 * `trail-photos` bucket). Guests keep them in memory for this visit only and are asked to sign in to keep them.
 */
export type RouteFeature = { id: string; type: string; name: string; lat: number; lon: number; mile: number; offRouteFt: number; source: string };
export type PersonalTrailStats = { miles: number; gainFt: number | null; lossFt: number | null; minFt: number | null; maxFt: number | null; hours: number | null };
export type PersonalTrailDay = { day: number; fromMile: number; toMile: number; miles: number; stop: RouteFeature | null };
export type PersonalTrail = { id: string; name: string; notes: string; photoUrl: string | null; geometry: [number, number][]; stats: PersonalTrailStats; trails: { id: string | null; name: string; fromMile: number; toMile: number }[]; features: RouteFeature[]; days: PersonalTrailDay[] | null; waypoints: [number, number][]; isPublic: boolean; shareToken: string | null; createdAt: string; updatedAt: string };
export type PersonalTrailInput = Omit<PersonalTrail, "id" | "createdAt" | "updatedAt" | "shareToken" | "photoUrl" | "isPublic"> & { id?: string; photo?: File | null };

const BUCKET = "trail-photos";
const CHANGED = "hyked:personal-trails";
const COLUMNS = "id, name, notes, photo_path, geometry, stats, trails, features, days, waypoints, is_public, share_token, created_at, updated_at";
/** Guest photos stay in memory as files (and object URLs) until the guest signs in. */
export const guestPhotos = new Map<string, File>();

type Row = { id: string; name: string; notes: string | null; photo_path: string | null; geometry: unknown; stats: unknown; trails: unknown; features: unknown; days: unknown; waypoints: unknown; is_public: boolean; share_token: string | null; created_at: string; updated_at: string };

const arr = <T,>(v: unknown): T[] => Array.isArray(v) ? v as T[] : [];
const EMPTY_STATS: PersonalTrailStats = { miles: 0, gainFt: null, lossFt: null, minFt: null, maxFt: null, hours: null };

export function rowToPersonalTrail(row: Row, photoUrl: string | null = null): PersonalTrail {
  return {
    id: row.id, name: row.name, notes: row.notes ?? "", photoUrl,
    geometry: arr<[number, number]>(row.geometry), stats: { ...EMPTY_STATS, ...(row.stats && typeof row.stats === "object" ? row.stats as Partial<PersonalTrailStats> : {}) },
    trails: arr(row.trails), features: arr<RouteFeature>(row.features), days: Array.isArray(row.days) ? row.days as PersonalTrailDay[] : null,
    waypoints: arr<[number, number]>(row.waypoints), isPublic: row.is_public, shareToken: row.share_token, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function personalTrailRow(input: PersonalTrailInput) {
  return { name: input.name.trim().slice(0, 200) || "My trail", notes: input.notes.slice(0, 10000), geometry: input.geometry, stats: input.stats, trails: input.trails, features: input.features, days: input.days, waypoints: input.waypoints };
}

async function session(): Promise<{ client: SupabaseClient; userId: string } | null> {
  const client = createClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session ? { client, userId: data.session.user.id } : null;
}

async function signedUrl(client: SupabaseClient, path: string | null) {
  if (!path) return null;
  // Short-lived so revoking a share cuts off photo access almost immediately.
  const { data } = await client.storage.from(BUCKET).createSignedUrl(path, 60);
  return data?.signedUrl ?? null;
}

async function withPhoto(client: SupabaseClient, row: Row) { return rowToPersonalTrail(row, await signedUrl(client, row.photo_path)); }

function changed() { if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED)); }
const guestTrails = () => [...guest.personalTrails.values()] as PersonalTrail[];

/** Upload a photo to the owner's folder; returns its storage path. */
export async function uploadTrailPhoto(client: SupabaseClient, userId: string, trailId: string, photo: File) {
  const ext = (photo.name.split(".").pop() || photo.type.split("/")[1] || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
  const path = `${userId}/${trailId}-${Date.now()}.${ext}`;
  const { error } = await client.storage.from(BUCKET).upload(path, photo, { contentType: photo.type || undefined, upsert: false });
  if (error) throw new Error(friendlyError(error, "The photo couldn’t be uploaded. Try a smaller image, or save without it."));
  return path;
}

export async function listPersonalTrails(): Promise<PersonalTrail[]> {
  const s = await session();
  if (!s) return guestTrails().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return trackCloud(async () => {
    const { data, error } = await s.client.from("personal_trails").select(COLUMNS).order("updated_at", { ascending: false }).limit(500);
    if (error) throw new Error(friendlyError(error, "Your trails couldn’t be reached right now. Try again in a moment."));
    return Promise.all((data as Row[]).map(row => withPhoto(s.client, row)));
  });
}

export async function getPersonalTrail(id: string): Promise<PersonalTrail | null> {
  const local = guest.personalTrails.get(id) as PersonalTrail | undefined;
  if (local) return local;
  const s = await session();
  if (!s || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await s.client.from("personal_trails").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(friendlyError(error, "Your trails couldn’t be reached right now. Try again in a moment."));
  return data ? withPhoto(s.client, data as Row) : null;
}

export async function getSharedPersonalTrail(token: string): Promise<PersonalTrail | null> {
  const client = createClient();
  if (!client || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null;
  const { data, error } = await client.rpc("get_shared_personal_trail", { token });
  if (error) throw new Error(friendlyError(error, "Your trails couldn’t be reached right now. Try again in a moment."));
  const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
  return row ? withPhoto(client, row) : null;
}

export async function savePersonalTrail(input: PersonalTrailInput): Promise<PersonalTrail> {
  const s = await session();
  const now = new Date().toISOString();
  if (!s) {
    const id = input.id ?? crypto.randomUUID();
    const previous = guest.personalTrails.get(id) as PersonalTrail | undefined;
    let photoUrl = previous?.photoUrl ?? null;
    if (input.photo) {
      if (photoUrl?.startsWith("blob:")) URL.revokeObjectURL(photoUrl);
      guestPhotos.set(id, input.photo);
      photoUrl = URL.createObjectURL(input.photo);
    }
    const trail: PersonalTrail = { ...personalTrailRow(input), id, photoUrl, isPublic: false, shareToken: null, createdAt: previous?.createdAt ?? now, updatedAt: now };
    guest.personalTrails.set(id, trail); guestChanged(); changed(); noteGuestProgress();
    return trail;
  }
  return trackCloud(async () => {
    const id = input.id ?? crypto.randomUUID();
    const photo_path = input.photo ? await uploadTrailPhoto(s.client, s.userId, id, input.photo) : undefined;
    const row = { ...personalTrailRow(input), ...(photo_path ? { photo_path } : {}) };
    const query = input.id
      ? s.client.from("personal_trails").update(row).eq("id", id).select(COLUMNS).single()
      : s.client.from("personal_trails").insert({ id, user_id: s.userId, ...row }).select(COLUMNS).single();
    const { data, error } = await query;
    if (error) throw new Error(friendlyError(error, "Your trails couldn’t be reached right now. Try again in a moment."));
    changed();
    return withPhoto(s.client, data as Row);
  });
}

export async function deletePersonalTrail(id: string): Promise<void> {
  if (guest.personalTrails.has(id)) {
    const t = guest.personalTrails.get(id) as PersonalTrail;
    if (t.photoUrl?.startsWith("blob:")) URL.revokeObjectURL(t.photoUrl);
    guest.personalTrails.delete(id); guestPhotos.delete(id); guestChanged(); changed();
    return;
  }
  const s = await session();
  if (!s) return;
  await trackCloud(async () => {
    const { data } = await s.client.from("personal_trails").select("photo_path").eq("id", id).maybeSingle();
    const { error } = await s.client.from("personal_trails").delete().eq("id", id);
    if (error) throw new Error(friendlyError(error, "Your trails couldn’t be reached right now. Try again in a moment."));
    if (data?.photo_path) await s.client.storage.from(BUCKET).remove([data.photo_path]);
  });
  changed();
}

export async function setPersonalTrailSharing(id: string, isPublic: boolean): Promise<PersonalTrail> {
  const s = await session();
  if (!s) throw new Error("Sign in to share a trail. Trails you build as a guest are kept only for this visit.");
  return trackCloud(async () => {
    const { data, error } = await s.client.from("personal_trails").update({ is_public: isPublic }).eq("id", id).select(COLUMNS).single();
    if (error) throw new Error(friendlyError(error, "Your trails couldn’t be reached right now. Try again in a moment."));
    changed();
    return withPhoto(s.client, data as Row);
  });
}

export function usePersonalTrails(): { trails: PersonalTrail[]; loading: boolean; refresh: () => void } {
  const [state, setState] = useState<{ trails: PersonalTrail[]; loading: boolean }>({ trails: [], loading: true });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);
  useEffect(() => {
    let active = true;
    listPersonalTrails().then(trails => { if (active) setState({ trails, loading: false }); }).catch(() => { if (active) setState(s => ({ ...s, loading: false })); });
    return () => { active = false; };
  }, [tick]);
  useEffect(() => {
    const client = createClient();
    const auth = client?.auth.onAuthStateChange(() => refresh());
    window.addEventListener(CHANGED, refresh);
    const unsubscribe = subscribeGuest(refresh);
    return () => { window.removeEventListener(CHANGED, refresh); unsubscribe(); auth?.data.subscription.unsubscribe(); };
  }, [refresh]);
  return { ...state, refresh };
}
