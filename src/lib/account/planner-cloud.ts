import { cleanProductDetails, cleanStoredProductDetails } from "@/lib/assistant/product-details";
import { CATEGORY_ORDER, type GearCategory, type GearType } from "@/lib/gear";
import { parseMemory } from "@/lib/assistant/memory";
import type { PlannerGear, PlannerMemory, PlannerProfile, SavedPlan } from "@/lib/assistant/types";

/** Row shapes and mappings between the trip planner's memory and the account tables (see the 20261021 migration). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (id: string) => UUID.test(id);

/** Gear made in the planner gets ids like `local:<uuid>`; in the account the uuid alone is the row id. */
export function cloudGearId(id: string): string {
  const bare = id.replace(/^local:/, "");
  return isUuid(bare) ? bare.toLowerCase() : crypto.randomUUID();
}

export function gearToRow(g: PlannerGear, userId: string) {
  return {
    id: cloudGearId(g.id), user_id: userId, name: g.name, category: g.category, type: g.type, qty: g.qty,
    weight: g.weightOz ?? 0, price: g.price ?? 0, link: g.sourceUrl ?? "",
    product_details: { ...cleanProductDetails(g), ...(g.packedSize ? { packedSize: g.packedSize } : {}) },
  };
}

/** A gear_items row as planner gear (weight is stored in ounces). */
export function rowToGear(g: Record<string, unknown>): PlannerGear {
  const details = cleanStoredProductDetails(g.product_details);
  const link = typeof g.link === "string" ? g.link : "";
  return {
    ...details, price: Number(g.price) || 0, id: String(g.id), name: String(g.name),
    category: CATEGORY_ORDER.includes(g.category as GearCategory) ? g.category as GearCategory : "Misc",
    type: ["Base", "Worn", "Consumable"].includes(String(g.type)) ? g.type as GearType : "Base",
    qty: Math.max(1, Number(g.qty) || 1), weightOz: Number(g.weight) > 0 ? Number(g.weight) : null,
    packedSize: details.packedSize ?? null, sourceUrl: /^https:\/\//i.test(link) ? link : null,
  };
}

export function planToRow(plan: SavedPlan, userId: string) {
  const personal = plan.route?.id.match(/^personal:([0-9a-f-]{36})$/i)?.[1] ?? null;
  return {
    user_id: userId, client_id: plan.id, name: (plan.route?.name ?? plan.request.region ?? "").slice(0, 200),
    plan, saved_at: plan.savedAt, personal_trail_id: personal,
  };
}

/** Cloud rows back into planner memory, through the same validation as everything else the planner reads. */
export function memoryFromRows(profile: unknown, plans: unknown[]): PlannerMemory {
  return parseMemory(JSON.stringify({ version: 1, profile: profile ?? {}, gear: [], plans }));
}

export const profileIsEmpty = (p: PlannerProfile) =>
  p.usualMilesPerDay === null && p.comfortablePackLb === null && p.packCapacityL === null && p.experience === "some" && !p.priorities;

/** What changed between two memories, as the writes the account needs. Gear is never deleted from here. */
export function plannerDiff(before: PlannerMemory, after: PlannerMemory) {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const oldGear = new Map(before.gear.map(g => [g.id, g]));
  const oldPlans = new Map(before.plans.map(p => [p.id, p]));
  const newPlanIds = new Set(after.plans.map(p => p.id));
  return {
    profile: same(before.profile, after.profile) ? null : after.profile,
    gear: after.gear.filter(g => !same(oldGear.get(g.id), g)),
    plans: after.plans.filter(p => !same(oldPlans.get(p.id), p)),
    removedPlans: before.plans.filter(p => !newPlanIds.has(p.id)).map(p => p.id),
  };
}
