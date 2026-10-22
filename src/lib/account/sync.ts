"use client";
import { useSyncExternalStore } from "react";

/**
 * Account sync status shown in the sidebar, plus a small in-memory retry queue: a write that fails because the
 * device is offline is retried when the connection returns (while the tab stays open). Nothing is queued on disk.
 */
export type SyncState = "guest" | "idle" | "syncing" | "synced" | "offline" | "error";
export interface SyncStatus { state: SyncState; lastSyncedAt: number | null; pending: number; message: string }

let status: SyncStatus = { state: "guest", lastSyncedAt: null, pending: 0, message: "" };
const listeners = new Set<() => void>();
const queue: (() => Promise<void>)[] = [];
let active = 0;

function set(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  for (const listener of listeners) listener();
}

export function getSyncStatus() { return status; }
export function subscribeSync(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function useSyncStatus() { return useSyncExternalStore(subscribeSync, getSyncStatus, getSyncStatus); }

/** Called when the signed-in account changes: guests have nothing to sync. */
export function setSyncAccount(signedIn: boolean) {
  queue.length = 0;
  set(signedIn ? { state: status.lastSyncedAt ? "synced" : "idle", pending: 0, message: "" } : { state: "guest", lastSyncedAt: null, pending: 0, message: "" });
}

const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;
export function isNetworkError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : String(error ?? "");
  return offline() || /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(message);
}

/**
 * Run one cloud write. Supabase calls resolve with `{ error }`, so the write returns that error (or throws);
 * network failures are queued and retried when the browser comes back online.
 */
export async function cloudWrite(write: () => PromiseLike<{ error?: { message: string } | null } | void>): Promise<boolean> {
  const attempt = async () => {
    const result = await write();
    if (result && result.error) throw result.error;
  };
  active++; set({ state: "syncing", pending: queue.length + active });
  try {
    await attempt();
    active--;
    set({ state: queue.length ? "offline" : active ? "syncing" : "synced", lastSyncedAt: Date.now(), pending: queue.length + active, message: "" });
    return true;
  } catch (error) {
    active--;
    if (isNetworkError(error)) {
      queue.push(attempt);
      set({ state: "offline", pending: queue.length + active, message: "" });
      return true;
    }
    set({ state: "error", pending: queue.length + active, message: error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error) });
    return false;
  }
}

/** A cloud read or write whose result the caller needs (not queued): shows syncing, then synced or the error. */
export async function trackCloud<T>(work: () => Promise<T>): Promise<T> {
  active++; set({ state: "syncing", pending: queue.length + active });
  try {
    const result = await work();
    active--;
    set({ state: queue.length ? "offline" : active ? "syncing" : "synced", lastSyncedAt: Date.now(), pending: queue.length + active, message: "" });
    return result;
  } catch (error) {
    active--;
    set(isNetworkError(error) ? { state: "offline", pending: queue.length + active } : { state: "error", pending: queue.length + active, message: error instanceof Error ? error.message : "A change could not be saved." });
    throw error;
  }
}

export async function flushQueue() {
  while (queue.length) {
    const next = queue[0];
    set({ state: "syncing", pending: queue.length });
    try { await next(); queue.shift(); }
    catch (error) {
      if (isNetworkError(error)) { set({ state: "offline", pending: queue.length }); return; }
      queue.shift();
      set({ state: "error", message: error instanceof Error ? error.message : "A change could not be saved." });
    }
  }
  set({ state: "synced", lastSyncedAt: Date.now(), pending: 0 });
}

if (typeof window !== "undefined") window.addEventListener("online", () => { if (queue.length) void flushQueue(); });

/** "Synced · just now", "Synced · 5 min ago", … */
export function syncLabel(s: SyncStatus, now = Date.now()): string {
  if (s.state === "guest") return "Guest · not saved";
  if (s.state === "syncing") return "Syncing…";
  if (s.state === "offline") return "Offline — changes will sync";
  if (s.state === "error") return "Sync problem — retry";
  if (!s.lastSyncedAt) return "Synced to your account";
  const minutes = Math.floor((now - s.lastSyncedAt) / 60_000);
  return minutes < 1 ? "Synced · just now" : minutes < 60 ? `Synced · ${minutes} min ago` : `Synced · ${Math.floor(minutes / 60)} h ago`;
}
