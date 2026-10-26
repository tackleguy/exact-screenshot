/**
 * "Save to list" for catalog trails: signed in, saved trails live in the account (favorite_trails); signed out,
 * on this device (localStorage) until sign-in. Every heart on the site reads and writes through here.
 */
import { useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";

const LOCAL = "hyked:saved-trails";
const EVENT = "hyked:saved-trails";
let ids = new Set<string>();
let userId: string | null = null;
let loaded = false;

function readLocal(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(LOCAL) ?? "[]") as string[]); } catch { return new Set(); }
}
function writeLocal(next: Set<string>) {
  try { localStorage.setItem(LOCAL, JSON.stringify([...next])); } catch { /* storage unavailable */ }
}
function emit() { window.dispatchEvent(new Event(EVENT)); }

async function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  ids = readLocal();
  const client = createClient();
  const session = client ? (await client.auth.getSession()).data.session : null;
  userId = session?.user.id ?? null;
  if (client && userId) {
    const { data, error } = await client.from("favorite_trails").select("catalog_trail_id");
    if (!error && data) {
      const local = [...ids];
      ids = new Set([...data.map((r) => r.catalog_trail_id as string), ...local]);
      // Hearts tapped as a guest move into the account.
      const missing = local.filter((id) => !data.some((r) => r.catalog_trail_id === id));
      if (missing.length) await client.from("favorite_trails").upsert(missing.map((id) => ({ user_id: userId, catalog_trail_id: id })));
    }
  }
  emit();
}

let snapshot: string[] = [];
function getSnapshot() {
  const next = [...ids].sort();
  if (next.join("|") !== snapshot.join("|")) snapshot = next;
  return snapshot;
}

/** The saved trail ids; loads them on first use. */
export function useSavedTrails(): string[] {
  return useSyncExternalStore(
    (onChange) => { void load(); window.addEventListener(EVENT, onChange); return () => window.removeEventListener(EVENT, onChange); },
    getSnapshot,
    () => snapshot,
  );
}

/** Saves or un-saves a trail; returns where it was kept ("account" or "device"). */
export async function toggleSaved(id: string): Promise<"account" | "device"> {
  await load();
  const saving = !ids.has(id);
  const next = new Set(ids);
  if (saving) next.add(id); else next.delete(id);
  ids = next;
  emit();
  const client = createClient();
  if (client && userId) {
    const { error } = saving
      ? await client.from("favorite_trails").upsert({ user_id: userId, catalog_trail_id: id })
      : await client.from("favorite_trails").delete().eq("user_id", userId).eq("catalog_trail_id", id);
    if (!error) return "account";
  }
  writeLocal(next);
  return "device";
}
