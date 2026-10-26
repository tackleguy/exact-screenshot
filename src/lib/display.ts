/**
 * Display guards: every formatter returns null for a missing, NaN or infinite value (or text that is literally
 * "undefined", "null" or "NaN"), so callers render nothing instead of a broken fact. Use these for every number
 * or string shown on trail pages, cards and lists.
 */
import { formatDistance, formatDuration, formatElevation } from "@/lib/units";

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s && !/^(undefined|null|nan|none|unknown)$/i.test(s) && !/\b(undefined|NaN)\b/.test(s) ? s : null;
}

/** A distance in miles, in the visitor's units (src/lib/units.ts). */
export function miles(v: unknown): string | null {
  return isNum(v) && v > 0 ? formatDistance(v) : null;
}

/** An elevation or climb in feet, in the visitor's units. */
export function feet(v: unknown): string | null {
  return isNum(v) ? formatElevation(v) : null;
}

export function count(v: unknown, singular: string, plural = `${singular}s`): string | null {
  return isNum(v) && v >= 0 ? `${Math.round(v).toLocaleString("en-US")} ${Math.round(v) === 1 ? singular : plural}` : null;
}

export function duration(hours: unknown): string | null {
  return isNum(hours) ? formatDuration(hours) : null;
}

/** Joins the parts that are present: join(["Utah", null, "3.2 mi"]) → "Utah · 3.2 mi"; null when none are. */
export function join(parts: unknown[], separator = " · "): string | null {
  const shown = parts.map((p) => (typeof p === "number" ? (isNum(p) ? String(p) : null) : text(p))).filter(Boolean);
  return shown.length ? shown.join(separator) : null;
}
