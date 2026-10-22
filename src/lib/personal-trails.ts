"use client";
// TEMPORARY in-memory stub for the route-builder branch; the cloud-data branch's implementation (Supabase,
// same interface) replaces this file at merge.
import { useCallback, useEffect, useState } from "react";

export type RouteFeature = { id: string; type: string; name: string; lat: number; lon: number; mile: number; offRouteFt: number; source: string };
export type PersonalTrailStats = { miles: number; gainFt: number | null; lossFt: number | null; minFt: number | null; maxFt: number | null; hours: number | null };
export type PersonalTrailDay = { day: number; fromMile: number; toMile: number; miles: number; stop: RouteFeature | null };
export type PersonalTrail = { id: string; name: string; notes: string; photoUrl: string | null; geometry: [number, number][]; stats: PersonalTrailStats; trails: { id: string | null; name: string; fromMile: number; toMile: number }[]; features: RouteFeature[]; days: PersonalTrailDay[] | null; waypoints: [number, number][]; isPublic: boolean; shareToken: string | null; createdAt: string; updatedAt: string };
export type PersonalTrailInput = Omit<PersonalTrail, "id" | "createdAt" | "updatedAt" | "shareToken" | "photoUrl" | "isPublic"> & { id?: string; photo?: File | null };

const store = new Map<string, PersonalTrail>();
const EVENT = "hyked:personal-trails";

export async function listPersonalTrails() { return [...store.values()]; }
export async function getPersonalTrail(id: string) { return store.get(id) ?? null; }
export async function getSharedPersonalTrail(token: string) { return [...store.values()].find((t) => t.isPublic && t.shareToken === token) ?? null; }
export async function savePersonalTrail(input: PersonalTrailInput): Promise<PersonalTrail> {
  const now = new Date().toISOString();
  const id = input.id ?? crypto.randomUUID();
  const prev = store.get(id);
  const { photo, ...rest } = input;
  const trail: PersonalTrail = { ...rest, id, photoUrl: photo ? URL.createObjectURL(photo) : prev?.photoUrl ?? null, isPublic: prev?.isPublic ?? false, shareToken: prev?.shareToken ?? null, createdAt: prev?.createdAt ?? now, updatedAt: now };
  store.set(id, trail);
  window.dispatchEvent(new Event(EVENT));
  return trail;
}
export async function deletePersonalTrail(id: string) { store.delete(id); window.dispatchEvent(new Event(EVENT)); }
export async function setPersonalTrailSharing(id: string, isPublic: boolean) {
  const t = store.get(id);
  if (!t) throw new Error("Trail not found.");
  const next = { ...t, isPublic, shareToken: isPublic ? t.shareToken ?? crypto.randomUUID() : null };
  store.set(id, next);
  window.dispatchEvent(new Event(EVENT));
  return next;
}
export function usePersonalTrails() {
  const [trails, setTrails] = useState<PersonalTrail[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(() => { void listPersonalTrails().then((list) => { setTrails(list); setLoading(false); }); }, []);
  useEffect(() => {
    let live = true;
    const load = () => void listPersonalTrails().then((list) => { if (live) { setTrails(list); setLoading(false); } });
    load();
    window.addEventListener(EVENT, load);
    return () => { live = false; window.removeEventListener(EVENT, load); };
  }, []);
  return { trails, loading, refresh };
}
