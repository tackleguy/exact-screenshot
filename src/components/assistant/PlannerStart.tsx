"use client";
import { useEffect, useMemo, useState } from "react";
import type { PlannerContext, RouteCandidate } from "@/lib/assistant/types";
import { getPersonalTrail, usePersonalTrails } from "@/lib/personal-trails";
import { decodeRouteParam, personalRouteCandidate, suggestedDays } from "@/lib/account/plan-route";
import { TripPlanner } from "./TripPlanner";

type Start = { key: string; route: RouteCandidate | null; days: number | null; error: string };

async function resolveStart(value: string): Promise<Start> {
  if (/^[0-9a-f-]{36}$/i.test(value)) {
    const trail = await getPersonalTrail(value).catch(() => null);
    return trail
      ? { key: value, route: personalRouteCandidate(trail), days: suggestedDays(trail), error: "" }
      : { key: value, route: null, days: null, error: "That personal trail isn’t in your account. Sign in with the account that saved it, or pick a route below." };
  }
  const decoded = decodeRouteParam(value);
  return decoded ? { key: value, ...decoded, error: "" } : { key: value, route: null, days: null, error: "That route link couldn’t be read. Pick a route below." };
}

/**
 * The trip planner, started from a catalog trail (`?prompt=…&region=…`), a personal trail (`?personalTrail=<id>`)
 * or a route built on the map (`?route=<personal trail id or encoded route>`). Personal trails are offered as routes.
 */
export function PlannerStart({ context, initialRegion = "", initialPrompt = "", routeParam = null }: { context: PlannerContext; initialRegion?: string; initialPrompt?: string; routeParam?: string | null }) {
  const { trails } = usePersonalTrails();
  const [start, setStart] = useState<Start | null>(null);
  useEffect(() => {
    if (!routeParam) return;
    let active = true;
    void resolveStart(routeParam).then(s => { if (active) setStart(s); });
    return () => { active = false; };
  }, [routeParam, context.userId]);
  const ready = !routeParam || start?.key === routeParam;
  const initialRoute = ready && routeParam ? start?.route ?? null : null;
  const routes = useMemo(() => {
    const all = [...context.routes, ...trails.map(personalRouteCandidate), ...(initialRoute ? [initialRoute] : [])];
    return [...new Map(all.map(r => [r.id, r])).values()];
  }, [context.routes, trails, initialRoute]);
  if (!ready) return <section className="fieldbook-page"><h1>Loading your route…</h1></section>;
  return <TripPlanner
    key={`${context.userId ?? "guest"}:${initialRoute?.id ?? ""}:${initialRegion}:${initialPrompt}`}
    context={{ ...context, routes, messages: start?.error ? [...context.messages, start.error] : context.messages }}
    initialRegion={initialRegion} initialPrompt={initialPrompt}
    initialRoute={initialRoute} initialDays={start?.days ?? null}
  />;
}
