/**
 * One unit setting (imperial or metric) and one set of formatters for every distance, elevation, grade and
 * duration on the site. The setting lives in localStorage ("hyked:units") and defaults from the browser language:
 * U.S. English (and Liberia, Myanmar) read imperial, everyone else metric.
 */
import { useSyncExternalStore } from "react";

export type Units = "imperial" | "metric";
const KEY = "hyked:units";
const EVENT = "hyked:units";
const MILE_M = 1609.344;
const FOOT_M = 0.3048;
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function defaultUnits(language = typeof navigator !== "undefined" ? navigator.language : "en-US"): Units {
  return /^(en-US|en-LR|my)(\b|-|$)/i.test(language) || /^en$/i.test(language) ? "imperial" : "metric";
}

export function getUnits(): Units {
  try {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (saved === "imperial" || saved === "metric") return saved;
  } catch { /* storage unavailable */ }
  return defaultUnits();
}

export function setUnits(units: Units) {
  try { localStorage.setItem(KEY, units); } catch { /* storage unavailable */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

/** The current units; components re-render when the setting changes. */
export function useUnits(): Units {
  return useSyncExternalStore(
    (onChange) => { window.addEventListener(EVENT, onChange); window.addEventListener("storage", onChange); return () => { window.removeEventListener(EVENT, onChange); window.removeEventListener("storage", onChange); }; },
    getUnits,
    () => "imperial",
  );
}

const thousands = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * A distance given in miles. Imperial: feet under 0.1 mi ("480 ft"), then miles. Metric: metres under 1 km
 * ("146 m"), then km. Null for a missing value.
 */
export function formatDistance(miles: number | null | undefined, units: Units = getUnits()): string | null {
  if (!fin(miles) || miles < 0) return null;
  if (units === "imperial") {
    if (miles < 0.1) return `${thousands(Math.max(10, Math.round((miles * MILE_M) / FOOT_M / 10) * 10))} ft`;
    return `${miles < 10 ? miles.toFixed(1) : thousands(miles)} mi`;
  }
  const km = (miles * MILE_M) / 1000;
  if (km < 1) return `${thousands(Math.max(5, Math.round((km * 1000) / 5) * 5))} m`;
  return `${km < 10 ? km.toFixed(1) : thousands(km)} km`;
}

/** A distance given in meters. */
export const formatMeters = (meters: number | null | undefined, units: Units = getUnits()) => (fin(meters) ? formatDistance(meters / MILE_M, units) : null);

/** An elevation or climb given in feet: "3,027 ft" or "923 m". */
export function formatElevation(feet: number | null | undefined, units: Units = getUnits()): string | null {
  if (!fin(feet)) return null;
  return units === "imperial" ? `${thousands(feet)} ft` : `${thousands(feet * FOOT_M)} m`;
}

export const GRADE_CAP = 60;
/** A grade in percent, capped at 60% (steeper readings are DEM noise more often than not). */
export function formatGrade(pct: number | null | undefined): string | null {
  if (!fin(pct) || pct < 0) return null;
  return pct > GRADE_CAP ? `${GRADE_CAP}%+ (estimated)` : `${Math.round(pct)}%`;
}

/** "2 h 45 min", rounded to the nearest 5 minutes. */
export function formatDuration(hours: number | null | undefined): string | null {
  if (!fin(hours) || hours <= 0) return null;
  const total = Math.max(5, Math.round((hours * 60) / 5) * 5);
  const h = Math.floor(total / 60), m = total % 60;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

/** "3–4 h": a range rounded to half hours (whole hours when both ends are whole). */
export function formatDurationRange(low: number, high: number): string | null {
  if (!fin(low) || !fin(high) || low <= 0) return null;
  const half = (v: number) => Math.max(0.5, Math.round(v * 2) / 2);
  const a = half(low), b = Math.max(half(high), a + 0.5);
  const show = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  return `${show(a)}–${show(b)} h`;
}

/** Speed for pace displays: "2.4 mph" or "3.9 km/h". */
export function formatSpeed(mph: number | null | undefined, units: Units = getUnits()): string | null {
  if (!fin(mph)) return null;
  return units === "imperial" ? `${mph.toFixed(1)} mph` : `${(mph * 1.609344).toFixed(1)} km/h`;
}

/** Pace from meters and seconds: "18:30 /mi" or "11:30 /km". */
export function formatPace(meters: number, seconds: number, units: Units = getUnits()): string | null {
  if (!(meters > 0) || !(seconds > 0)) return null;
  const per = units === "imperial" ? seconds / (meters / MILE_M) : seconds / (meters / 1000);
  if (!Number.isFinite(per) || per > 6 * 3600) return null;
  const m = Math.floor(per / 60), s = Math.round(per % 60);
  return `${m}:${String(s === 60 ? 59 : s).padStart(2, "0")} /${units === "imperial" ? "mi" : "km"}`;
}

/**
 * Hiking time, Naismith's rule with Langmuir's corrections: 3 mph (imperial) or 5 km/h (metric) on the flat, plus
 * 1 h per 2,000 ft of ascent, plus 1 h per 1,000 ft of descent steeper than 12%, minus 10 min per 1,000 ft of
 * gentler descent.
 */
export function hikingHours({ miles, gainFt, steepDescentFt = 0, gentleDescentFt = 0 }: { miles: number | null | undefined; gainFt?: number | null; steepDescentFt?: number | null; gentleDescentFt?: number | null }, units: Units = getUnits()): number | null {
  if (!fin(miles) || miles <= 0) return null;
  const flat = units === "imperial" ? miles / 3 : (miles * MILE_M) / 1000 / 5;
  const up = fin(gainFt) ? Math.max(0, gainFt) / 2000 : 0;
  const steep = fin(steepDescentFt) ? Math.max(0, steepDescentFt) / 1000 : 0;
  const gentle = fin(gentleDescentFt) ? (Math.max(0, gentleDescentFt) / 1000) * (10 / 60) : 0;
  return Math.max(flat * 0.5, flat + up + steep - gentle);
}

/**
 * Descent split for Langmuir from a trail's stored totals: the share counted as steep grows from none at a
 * steepest grade of 12% to all of it at 36%.
 */
export function splitDescent(lossFt: number | null | undefined, steepestGradePct: number | null | undefined) {
  const loss = fin(lossFt) ? Math.max(0, lossFt) : 0;
  const share = fin(steepestGradePct) ? Math.min(1, Math.max(0, (steepestGradePct - 12) / 24)) : 0;
  return { steepDescentFt: loss * share, gentleDescentFt: loss * (1 - share) };
}
