import type { TownNearTrail } from "./towns-core";
import { SERVICE_LABELS, type ServiceKey, type TownServices } from "./services";
import { round } from "@/lib/geo/line";

export interface TownDayOptions {
  trailMiles: number;
  /** Hiking days planned (town days are added on top). */
  days: number;
  /** Pounds of food per day; 1.5–2 lb is typical for backpacking. */
  foodLbPerDay?: number;
  /** Most days of food you are willing to carry between towns. */
  maxCarryDays?: number;
  /** Farthest you will detour off trail to reach a town, in miles. */
  maxMilesOffTrail?: number;
  /** Take a full rest day ("zero") in towns, not just a half day ("nero"). */
  zeroDays?: boolean;
  startDate?: string | null;
  /** Consumables from the pack list (fuel, filters, sunscreen…) to restock in town. */
  consumables?: string[];
}

export interface TownDayStop {
  town: TownNearTrail;
  services: TownServices | null;
  /** Mile along the trail where you leave it for town. */
  trailMile: number;
  /** Hiking day you reach the turnoff (1-based). */
  arriveDay: number;
  date: string | null;
  kind: "nero" | "zero";
  /** Days of food to buy for the next stretch. */
  foodDays: number;
  foodLb: number;
  checklist: string[];
  warnings: string[];
}

export interface TownDayPlan {
  milesPerDay: number;
  foodLbPerDay: number;
  startFoodDays: number;
  startFoodLb: number;
  stops: TownDayStop[];
  /** Stretches longer than maxCarryDays with no reachable town: plan a mailed box or cache. */
  gaps: { fromMile: number; toMile: number; days: number }[];
  totalDays: number;
  notes: string[];
}

const DAY_MS = 86_400_000;
const dateAfter = (start: string | null | undefined, days: number) => {
  if (!start) return null;
  const t = Date.parse(start);
  return Number.isFinite(t) ? new Date(t + days * DAY_MS).toISOString().slice(0, 10) : null;
};

/** What to do in a town, based on the stretch ahead and what the town has. */
export function townChecklist(services: TownServices | null, foodDays: number, foodLb: number, consumables: string[] = []) {
  const has = (k: ServiceKey) => (services?.counts[k] ?? 0) > 0;
  const checklist = [
    `Buy about ${foodLb} lb of food for ${foodDays} day${foodDays === 1 ? "" : "s"} to the next stop`,
    "Check stove fuel; replace a canister under about a third full",
    "Restock water treatment (tablets, drops) and check your filter",
    "Charge phone, headlamp and GPS; top up a battery bank",
    "Restock first aid, blister care, sunscreen and toilet paper",
    "Pack out trash and dispose of it in town",
    ...consumables.slice(0, 8).map((item) => `Restock ${item}`),
  ];
  if (has("laundry")) checklist.push("Do laundry");
  if (has("post")) checklist.push("Post office: pick up a resupply box or send gear home");
  if (has("outfitter")) checklist.push("Outfitter in town for gear repairs or replacements");
  const warnings: string[] = [];
  if (services && !has("grocery")) warnings.push("No grocery store is mapped here. Mail yourself a resupply box or confirm a store before relying on it.");
  if (services && !has("post")) warnings.push("No post office is mapped here, so a mailed box may not be possible.");
  if (!services) warnings.push("Services for this town could not be checked. Confirm a grocery store before relying on it.");
  return { checklist, warnings };
}

/**
 * Splits a hike into stretches between resupply towns so you never carry more than `maxCarryDays` of
 * food. Hikes linearly at the planned pace; picks, for each stretch, the farthest reachable town.
 */
export function planTownDays(
  towns: (TownNearTrail & { services?: TownServices | null })[],
  options: TownDayOptions,
): TownDayPlan {
  const days = Math.max(1, Math.round(options.days));
  const milesPerDay = round(options.trailMiles / days, 1) || options.trailMiles;
  const foodLbPerDay = options.foodLbPerDay ?? 1.75;
  const maxCarryDays = Math.max(1, Math.round(options.maxCarryDays ?? 5));
  const maxOff = options.maxMilesOffTrail ?? 15;
  const reach = maxCarryDays * milesPerDay;
  const candidates = towns.filter((t) => t.milesOffTrail <= maxOff).sort((a, b) => a.trailMile - b.trailMile);

  const stops: TownDayStop[] = [];
  const gaps: TownDayPlan["gaps"] = [];
  let position = 0, restDays = 0;
  while (options.trailMiles - position > reach + 1e-9) {
    const inRange = candidates.filter((t) => t.trailMile > position + milesPerDay * 0.5 && t.trailMile <= position + reach);
    if (!inRange.length) {
      const next = candidates.find((t) => t.trailMile > position + reach);
      const to = next ? next.trailMile : options.trailMiles;
      gaps.push({ fromMile: round(position, 1), toMile: round(to, 1), days: Math.ceil((to - position) / milesPerDay) });
      if (!next) break;
      position = next.trailMile;
      continue;
    }
    // Farthest town in range; among towns at nearly the same mile, the one with a grocery store.
    const farthest = Math.max(...inRange.map((t) => t.trailMile));
    const pick = inRange
      .filter((t) => t.trailMile >= farthest - milesPerDay * 0.5)
      .sort((a, b) => Number((b.services?.counts.grocery ?? 0) > 0) - Number((a.services?.counts.grocery ?? 0) > 0) || a.milesOffTrail - b.milesOffTrail)[0];
    const remaining = options.trailMiles - pick.trailMile;
    const foodDays = Math.min(maxCarryDays, Math.max(1, Math.ceil(remaining / milesPerDay)));
    const foodLb = round(foodDays * foodLbPerDay, 1);
    const arriveDay = Math.max(1, Math.ceil(pick.trailMile / milesPerDay));
    const services = pick.services ?? null;
    const { checklist, warnings } = townChecklist(services, foodDays, foodLb, options.consumables);
    stops.push({
      town: pick,
      services,
      trailMile: pick.trailMile,
      arriveDay,
      date: dateAfter(options.startDate, arriveDay - 1 + restDays),
      kind: options.zeroDays ? "zero" : "nero",
      foodDays,
      foodLb,
      checklist,
      warnings,
    });
    if (options.zeroDays) restDays++;
    position = pick.trailMile;
  }

  const firstLeg = stops[0]?.trailMile ?? options.trailMiles;
  const startFoodDays = Math.min(maxCarryDays, Math.max(1, Math.ceil(firstLeg / milesPerDay)));
  const notes = [
    `Planned at ${milesPerDay} miles a day over ${days} hiking day${days === 1 ? "" : "s"}, carrying at most ${maxCarryDays} days of food.`,
    "Town distances are straight-line from the trail; the walk or hitch into town is usually longer. Check business hours before you go.",
  ];
  if (gaps.length) notes.push("Some stretches have no town within reach: mail a resupply box to a post office or trailhead lodge, or carry more food.");
  if (!stops.length && !gaps.length) notes.push("You can carry all your food for this trip; no town stop is needed.");
  return {
    milesPerDay,
    foodLbPerDay,
    startFoodDays,
    startFoodLb: round(startFoodDays * foodLbPerDay, 1),
    stops,
    gaps,
    totalDays: days + (options.zeroDays ? stops.length : 0),
    notes,
  };
}

export const serviceSummary = (services: TownServices | null) =>
  services ? (Object.keys(SERVICE_LABELS) as ServiceKey[]).filter((k) => (services.counts[k] ?? 0) > 0).map((k) => SERVICE_LABELS[k]) : [];
