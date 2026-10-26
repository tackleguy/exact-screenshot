/**
 * Where the map and the "near you" list start, the same way everywhere:
 *   1. a place in the URL (lat/lng/z),
 *   2. the visitor's last map view (localStorage),
 *   3. their location, if the browser gives it within 3 seconds,
 *   4. a hiking region guessed from the browser's time zone (America/Los_Angeles → Southern California),
 * never the empty middle of the United States.
 */
import { useSyncExternalStore } from "react";
export interface StartView { center: [number, number]; zoom: number; label: string; source: "url" | "last" | "location" | "timezone" }

const LAST_VIEW_KEY = "hyked:last-view";

/** Popular hiking regions by IANA time zone: [name, lng, lat, zoom]. */
const ZONES: Record<string, [string, number, number, number]> = {
  "America/Los_Angeles": ["Southern California", -118.2, 34.25, 9],
  "America/Vancouver": ["the Vancouver area", -123.0, 49.35, 9],
  "America/Denver": ["Colorado's Front Range", -105.4, 39.75, 9],
  "America/Boise": ["the Boise area", -116.1, 43.65, 9],
  "America/Phoenix": ["the Phoenix area", -111.9, 33.6, 9],
  "America/Edmonton": ["the Canadian Rockies", -115.6, 51.15, 9],
  "America/Chicago": ["the Chicago area", -87.9, 41.9, 9],
  "America/Winnipeg": ["the Winnipeg area", -97.1, 49.9, 9],
  "America/New_York": ["the New York area", -74.1, 41.1, 9],
  "America/Detroit": ["the Detroit area", -83.3, 42.4, 9],
  "America/Indiana/Indianapolis": ["the Indianapolis area", -86.15, 39.8, 9],
  "America/Kentucky/Louisville": ["the Louisville area", -85.75, 38.25, 9],
  "America/Toronto": ["the Toronto area", -79.5, 43.75, 9],
  "America/Montreal": ["the Montréal area", -73.6, 45.55, 9],
  "America/Halifax": ["the Halifax area", -63.6, 44.7, 9],
  "America/St_Johns": ["the St. John's area", -52.75, 47.55, 9],
  "America/Anchorage": ["the Anchorage area", -149.6, 61.2, 9],
  "Pacific/Honolulu": ["Oʻahu", -157.95, 21.45, 10],
  "America/Mexico_City": ["the Mexico City area", -99.15, 19.4, 9],
  "America/Santiago": ["the Santiago area", -70.6, -33.45, 9],
  "America/Argentina/Buenos_Aires": ["the Buenos Aires area", -58.4, -34.6, 9],
  "America/Sao_Paulo": ["the São Paulo area", -46.6, -23.55, 9],
  "Europe/London": ["the Lake District", -3.1, 54.5, 9],
  "Europe/Dublin": ["the Wicklow Mountains", -6.35, 53.1, 9],
  "Europe/Paris": ["the French Alps", 6.5, 45.9, 8],
  "Europe/Berlin": ["the Bavarian Alps", 11.1, 47.55, 8],
  "Europe/Zurich": ["the Bernese Oberland", 7.9, 46.6, 9],
  "Europe/Vienna": ["Tyrol", 11.4, 47.25, 8],
  "Europe/Rome": ["the Dolomites", 11.85, 46.5, 9],
  "Europe/Madrid": ["the Sierra de Guadarrama", -3.95, 40.8, 9],
  "Europe/Lisbon": ["the Sintra hills", -9.4, 38.8, 10],
  "Europe/Amsterdam": ["the Veluwe", 5.85, 52.1, 9],
  "Europe/Brussels": ["the Ardennes", 5.7, 50.3, 9],
  "Europe/Oslo": ["the Oslo area", 10.7, 59.95, 9],
  "Europe/Stockholm": ["the Stockholm area", 18.05, 59.35, 9],
  "Europe/Copenhagen": ["the Copenhagen area", 12.5, 55.7, 9],
  "Europe/Helsinki": ["the Helsinki area", 24.9, 60.2, 9],
  "Europe/Warsaw": ["the Tatra Mountains", 19.95, 49.25, 9],
  "Europe/Prague": ["Bohemian Switzerland", 14.3, 50.9, 9],
  "Europe/Athens": ["the Athens area", 23.75, 38.0, 9],
  "Asia/Tokyo": ["the Tokyo area", 139.2, 35.6, 9],
  "Asia/Seoul": ["the Seoul area", 127.0, 37.6, 9],
  "Asia/Kathmandu": ["the Kathmandu valley", 85.3, 27.7, 9],
  "Australia/Sydney": ["the Blue Mountains", 150.4, -33.7, 9],
  "Australia/Melbourne": ["the Melbourne area", 145.2, -37.8, 9],
  "Australia/Brisbane": ["the Brisbane area", 152.9, -27.45, 9],
  "Australia/Perth": ["the Perth hills", 116.1, -31.95, 9],
  "Pacific/Auckland": ["the Auckland area", 174.75, -36.85, 9],
  "Africa/Johannesburg": ["the Magaliesberg", 27.8, -25.8, 9],
};

/** The hiking region for the browser's time zone; an approximate region from the UTC offset otherwise. */
export function timezoneRegion(timeZone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ""; } })()): StartView {
  const hit = ZONES[timeZone];
  if (hit) return { label: hit[0], center: [hit[1], hit[2]], zoom: hit[3], source: "timezone" };
  // Unknown zone: the longitude its offset implies, at a latitude typical for the continent.
  const offset = -new Date().getTimezoneOffset() / 60;
  const lat = /^America\//.test(timeZone) ? 40 : /^Europe\//.test(timeZone) ? 48 : /^Australia\//.test(timeZone) ? -33 : /^Africa\//.test(timeZone) ? 0 : 30;
  return { label: "your region", center: [Math.max(-170, Math.min(170, offset * 15)), lat], zoom: 6, source: "timezone" };
}

export function lastView(): StartView | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_VIEW_KEY) ?? "null") as { lng: number; lat: number; z: number } | null;
    if (v && [v.lng, v.lat, v.z].every(Number.isFinite) && Math.abs(v.lat) <= 85 && Math.abs(v.lng) <= 180) return { center: [v.lng, v.lat], zoom: Math.max(2, Math.min(18, v.z)), label: "your last view", source: "last" };
  } catch { /* storage unavailable */ }
  return null;
}

export function saveLastView(lng: number, lat: number, z: number) {
  try { localStorage.setItem(LAST_VIEW_KEY, JSON.stringify({ lng: +lng.toFixed(4), lat: +lat.toFixed(4), z: +z.toFixed(2) })); } catch { /* storage unavailable */ }
}

/** The visitor's position, or null when it isn't given within `timeoutMs` (default 3 s). */
export function locate(timeoutMs = 3000): Promise<[number, number] | null> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(timer); rememberPosition([p.coords.longitude, p.coords.latitude]); resolve([p.coords.longitude, p.coords.latitude]); },
      () => { clearTimeout(timer); resolve(null); },
      { timeout: timeoutMs, maximumAge: 600_000, enableHighAccuracy: false },
    );
  });
}

// The last position the browser gave (this tab only), so cards can say how far away each trail is.
const POSITION = "hyked:position";
export function rememberPosition(at: [number, number]) {
  try { sessionStorage.setItem(POSITION, JSON.stringify(at)); } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(POSITION));
}
let lastRaw: string | null = null, lastAt: [number, number] | null = null;
/** The visitor's last known position this session ([lng, lat]), or null when they haven't shared it. */
export function knownPosition(): [number, number] | null {
  let raw: string | null = null;
  try { raw = sessionStorage.getItem(POSITION); } catch { /* storage unavailable */ }
  if (raw !== lastRaw) { lastRaw = raw; try { lastAt = raw ? (JSON.parse(raw) as [number, number]) : null; } catch { lastAt = null; } }
  return lastAt;
}
/** knownPosition() as React state, updated whenever the browser gives a new position. */
export function useKnownPosition() {
  return useSyncExternalStore((cb) => { window.addEventListener(POSITION, cb); return () => window.removeEventListener(POSITION, cb); }, knownPosition, () => null);
}

/** The view to open at once (URL, last view or time-zone region); a located visitor is moved there afterwards. */
export function immediateStart(url: { center: [number, number] | null; zoom: number | null }): StartView {
  if (url.center) return { center: url.center, zoom: url.zoom ?? 12, label: "this place", source: "url" };
  return lastView() ?? timezoneRegion();
}
