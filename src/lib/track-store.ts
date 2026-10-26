/**
 * The in-progress recording, kept in IndexedDB so a crash, a refresh or a closed tab doesn't lose it. The recorder
 * saves every 10 accepted points and offers "Resume recording?" when it finds one.
 */
import type { Fix, GpsActivity } from "./gps-track";

export interface SavedTrack {
  activity: GpsActivity;
  title: string;
  trailId: string | null;
  startedAt: number;
  /** Milliseconds spent paused so far. */
  pausedMs: number;
  fixes: Fix[];
  savedAt: number;
}

const DB = "hyked-recorder";
const STORE = "tracks";
const KEY = "current";

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = act(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    } catch { resolve(null); }
  });
}

export const saveTrack = (track: SavedTrack) => run("readwrite", (s) => s.put(track, KEY));
export const loadTrack = () => run<SavedTrack>("readonly", (s) => s.get(KEY) as IDBRequest<SavedTrack>);
export const clearTrack = () => run("readwrite", (s) => s.delete(KEY));
