/**
 * Display guards: every formatter returns null for a missing, NaN or infinite value (or text that is literally
 * "undefined", "null" or "NaN"), so callers render nothing instead of a broken fact. Use these for every number
 * or string shown on trail pages, cards and lists.
 */
export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s && !/^(undefined|null|nan|none|unknown)$/i.test(s) && !/\b(undefined|NaN)\b/.test(s) ? s : null;
}

export function miles(v: unknown): string | null {
  if (!isNum(v) || v <= 0) return null;
  if (v < 0.1) return `${Math.round(v * 1609.344)} m`;
  return `${v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString("en-US")} mi`;
}

export function feet(v: unknown): string | null {
  return isNum(v) ? `${Math.round(v).toLocaleString("en-US")} ft` : null;
}

export function count(v: unknown, singular: string, plural = `${singular}s`): string | null {
  return isNum(v) && v >= 0 ? `${Math.round(v).toLocaleString("en-US")} ${Math.round(v) === 1 ? singular : plural}` : null;
}

export function duration(hours: unknown): string | null {
  if (!isNum(hours) || hours <= 0) return null;
  const h = Math.floor(hours), m = Math.round(((hours - h) * 60) / 5) * 5;
  if (!h) return `${Math.max(5, m)} min`;
  return m === 60 ? `${h + 1} h` : `${h} h${m ? ` ${m} min` : ""}`;
}

/** Joins the parts that are present: join(["Utah", null, "3.2 mi"]) → "Utah · 3.2 mi"; null when none are. */
export function join(parts: unknown[], separator = " · "): string | null {
  const shown = parts.map((p) => (typeof p === "number" ? (isNum(p) ? String(p) : null) : text(p))).filter(Boolean);
  return shown.length ? shown.join(separator) : null;
}
