/**
 * Browser-side caches that make trail pages open instantly:
 *
 * - Summaries: the list rows a visitor has seen (search, "Trails near me", nearby lists). A trail page opened from
 *   a list draws its title, stats and description from the row at once, before the full record arrives. Kept in
 *   memory and in sessionStorage, so a reload in the same tab still has them.
 * - Details: full trail records with their lines, kept in memory for the session, so back/forward and revisits
 *   render with no loading state at all.
 * - JSON: one shared request per URL for the trail page's sections (features, elevation), so the description,
 *   highlights and elevation chart don't each fetch the same data.
 */
import type { CatalogManifest, CatalogTrail } from "./types";

export interface TrailDetailData { trail: CatalogTrail; lines: [number, number][][]; manifest?: CatalogManifest | null; parent?: { id: string; name: string; miles: number | null } | null }

const SUMMARY_KEY = "hyked:trail-summaries";
const SUMMARY_LIMIT = 300;
const DETAIL_LIMIT = 40;
const JSON_LIMIT = 120;

const summaries = new Map<string, CatalogTrail>();
let summariesRead = false;
const details = new Map<string, TrailDetailData>();
const json = new Map<string, Promise<unknown>>();
let manifest: Promise<CatalogManifest | null> | null = null;

const storage = () => { try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; } };

function readSummaries() {
  if (summariesRead) return;
  summariesRead = true;
  try {
    const rows = JSON.parse(storage()?.getItem(SUMMARY_KEY) ?? "[]") as CatalogTrail[];
    for (const r of rows) if (r?.id && !summaries.has(r.id)) summaries.set(r.id, r);
  } catch { /* unreadable: start empty */ }
}
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveSummaries() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { storage()?.setItem(SUMMARY_KEY, JSON.stringify([...summaries.values()].slice(-SUMMARY_LIMIT))); } catch { /* full or blocked */ }
  }, 300);
}
const trim = <K, V>(map: Map<K, V>, limit: number) => { while (map.size > limit) map.delete(map.keys().next().value as K); };

/** Remembers list rows so their trail pages can open instantly. */
export function rememberTrails(trails: readonly CatalogTrail[] | null | undefined) {
  if (!trails?.length) return;
  readSummaries();
  for (const t of trails) {
    if (!t?.id || !t.name) continue;
    summaries.delete(t.id);
    summaries.set(t.id, t);
  }
  trim(summaries, SUMMARY_LIMIT);
  saveSummaries();
}

/** The list row for a trail, when the visitor has seen one this session. */
export function trailSummary(id: string): CatalogTrail | null {
  readSummaries();
  return details.get(id)?.trail ?? summaries.get(id) ?? null;
}

/** A full trail record loaded earlier this session. */
export function cachedTrailDetail(id: string): TrailDetailData | null {
  return details.get(id) ?? null;
}

/** Keeps a full trail record (and its own id, when it was opened through a merged id). */
export function rememberTrailDetail(id: string, data: TrailDetailData) {
  details.delete(id);
  details.set(id, data);
  if (data.trail.id !== id) details.set(data.trail.id, data);
  trim(details, DETAIL_LIMIT);
  rememberTrails([data.trail]);
}

/** GET a JSON endpoint once per session; a failure is forgotten so the next call retries. */
export function cachedJson<T>(url: string): Promise<T> {
  let hit = json.get(url) as Promise<T> | undefined;
  if (!hit) {
    hit = fetch(url).then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as { error?: string }).error ?? "This couldn’t load right now.");
      return data as T;
    });
    hit.catch(() => json.delete(url));
    json.set(url, hit);
    trim(json, JSON_LIMIT);
  }
  return hit;
}

/** Seeds the JSON cache with a response another view already loaded. */
export function primeJson(url: string, value: unknown) {
  if (!json.has(url)) json.set(url, Promise.resolve(value));
}

/** The catalog manifest (sources and snapshot date), loaded once. */
export function catalogManifest(): Promise<CatalogManifest | null> {
  manifest ??= fetch("/api/trail-catalog?limit=1").then((r) => (r.ok ? r.json() : null)).then((d) => (d?.manifest as CatalogManifest | undefined) ?? null).catch(() => { manifest = null; return null; });
  return manifest;
}

const inflight = new Map<string, Promise<TrailDetailData>>();
/** The full trail record: from this session's cache, else one shared request (with the manifest when missing). */
export function loadTrailDetail(id: string): Promise<TrailDetailData> {
  const cached = details.get(id);
  if (cached?.manifest) return Promise.resolve(cached);
  // Kept by another view without the manifest (a hosted API answer): add it.
  if (cached) return catalogManifest().then((manifest) => { const full = { ...cached, manifest }; rememberTrailDetail(id, full); return full; });
  let hit = inflight.get(id);
  if (!hit) {
    hit = fetch(`/api/trail-catalog/${encodeURIComponent(id)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((data as { error?: string }).error ?? "This trail couldn’t load right now.");
        return data as TrailDetailData;
      })
      .then(async (d) => {
        // The static site returns the manifest with the trail; a hosted API may not.
        const full = { ...d, lines: d.lines ?? [], manifest: d.manifest ?? (await catalogManifest()) };
        rememberTrailDetail(id, full);
        return full;
      })
      .finally(() => inflight.delete(id));
    inflight.set(id, hit);
  }
  return hit;
}
