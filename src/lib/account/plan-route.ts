import type { RouteCandidate } from "@/lib/assistant/types";
import type { PersonalTrail } from "@/lib/personal-trails";

/** A personal trail (or a route built on the map) as a route the trip planner can prepare a trip for. */
export function personalRouteCandidate(t: PersonalTrail): RouteCandidate {
  const along = [...new Set(t.trails.map(x => x.name).filter(Boolean))];
  const miles = Math.max(0.1, Math.round(t.stats.miles * 10) / 10);
  return {
    id: `personal:${t.id}`, name: t.name, region: along.length ? `Along ${along.slice(0, 3).join(", ")}${along.length > 3 ? "…" : ""}` : "Your personal trail",
    distanceMiles: miles, elevationFt: t.stats.gainFt === null ? null : Math.round(t.stats.gainFt), difficulty: "Personal route",
    sourceUrl: null, sourceLabel: "Your personal trail",
    note: t.days?.length ? `Built on the map along mapped trails, planned over ${t.days.length} ${t.days.length === 1 ? "day" : "days"}. Confirm permits, campsites and current conditions.` : "Built on the map along mapped trails. Confirm permits, campsites and current conditions.",
  };
}

/** Days for a route: the route's own day plan, or about 12 miles a day. */
export function suggestedDays(t: Pick<PersonalTrail, "days" | "stats">) {
  return t.days?.length ? t.days.length : Math.max(1, Math.ceil(t.stats.miles / 12));
}

/** `?route=` may also carry a small encoded route (base64url JSON: name, miles, gainFt, days). */
export function decodeRouteParam(value: string): { route: RouteCandidate; days: number | null } | null {
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)))) as { name?: unknown; miles?: unknown; gainFt?: unknown; days?: unknown; region?: unknown };
    const miles = Number(json.miles);
    if (typeof json.name !== "string" || !json.name.trim() || !Number.isFinite(miles) || miles < 0.1 || miles > 5000) return null;
    const gain = typeof json.gainFt === "number" ? json.gainFt : NaN;
    const days = typeof json.days === "number" ? json.days : NaN;
    return {
      route: { id: `route:${json.name.trim().slice(0, 60)}:${miles}`, name: json.name.trim().slice(0, 180), region: typeof json.region === "string" ? json.region.slice(0, 200) : "Route built on the map", distanceMiles: Math.round(miles * 10) / 10, elevationFt: Number.isFinite(gain) && gain >= 0 ? Math.round(gain) : null, difficulty: "Personal route", sourceUrl: null, sourceLabel: "Route built on the map", note: "Built on the map along mapped trails. Confirm permits, campsites and current conditions." },
      days: Number.isInteger(days) && days >= 1 && days <= 365 ? days : null,
    };
  } catch { return null; }
}

export function encodeRouteParam(r: { name: string; miles: number; gainFt?: number | null; days?: number | null; region?: string }) {
  const bytes = new TextEncoder().encode(JSON.stringify(r));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
