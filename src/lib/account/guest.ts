import { emptyMemory, parseMemory } from "@/lib/assistant/memory";
import type { PlannerMemory } from "@/lib/assistant/types";

/**
 * What a guest creates (planner preferences, gear, trips, personal trails, saved routes) lives only in memory
 * for this visit: nothing is written to the device. Signing in moves it to the account (see migrate.ts).
 * An OAuth sign-in leaves the page, so just before that redirect the guest's work is handed over through
 * sessionStorage and removed again as soon as it reaches the account.
 */
export interface GuestSavedRoute { name: string; meters: number; geometry: [number, number][]; trailIds: string[] }
export interface GuestState { planner: PlannerMemory; personalTrails: Map<string, unknown>; savedRoutes: GuestSavedRoute[] }

const state: GuestState = { planner: emptyMemory(), personalTrails: new Map(), savedRoutes: [] };
const listeners = new Set<() => void>();
let version = 0;

export const guest = state;
export function guestVersion() { return version; }
export function subscribeGuest(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function guestChanged() { version++; for (const listener of listeners) listener(); }

export function setGuestPlanner(memory: PlannerMemory) { state.planner = memory; guestChanged(); }

export function guestHasData(s: GuestState = state) {
  return s.planner.gear.length > 0 || s.planner.plans.length > 0 || s.personalTrails.size > 0 || s.savedRoutes.length > 0 ||
    JSON.stringify(s.planner.profile) !== JSON.stringify(emptyMemory().profile);
}

export function clearGuest() {
  state.planner = emptyMemory(); state.personalTrails.clear(); state.savedRoutes = [];
  guestChanged();
}

export const HANDOFF_KEY = "hyked:guest-handoff";

export function serializeGuest(s: GuestState = state): string {
  return JSON.stringify({ planner: s.planner, personalTrails: [...s.personalTrails.values()], savedRoutes: s.savedRoutes });
}

export function parseGuestHandoff(raw: string | null): GuestState | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { planner?: unknown; personalTrails?: unknown[]; savedRoutes?: unknown[] };
    const trails = Array.isArray(data.personalTrails) ? data.personalTrails.filter((t): t is { id: string } => Boolean(t && typeof t === "object" && typeof (t as { id?: unknown }).id === "string")) : [];
    return {
      planner: parseMemory(JSON.stringify(data.planner ?? null)),
      personalTrails: new Map(trails.map(t => [t.id, t])),
      savedRoutes: Array.isArray(data.savedRoutes) ? data.savedRoutes as GuestSavedRoute[] : [],
    };
  } catch { return null; }
}

/** Before an OAuth redirect: keep the guest's work for the round trip (removed once it reaches the account). */
export function handOffGuestBeforeRedirect() {
  if (!guestHasData()) return;
  try { sessionStorage.setItem(HANDOFF_KEY, serializeGuest()); } catch { /* storage blocked: the work stays in this tab only */ }
}

export function takeGuestHandoff(): GuestState | null {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    sessionStorage.removeItem(HANDOFF_KEY);
    return parseGuestHandoff(raw);
  } catch { return null; }
}
