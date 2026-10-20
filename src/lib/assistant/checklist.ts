import { gearWeightOz, packReport, preparationChecks, REFERENCES } from "./planning";
import { formatPackWeight, packingGuide, weightBreakdown, type PackUnits } from "./packing";
import type { PlannerGear, RouteCandidate, TripRequest } from "./types";

export function tripChecklist(request: TripRequest, route: RouteCandidate | null, gear: PlannerGear[], packed: string[], units: PackUnits = "imperial") {
  const report = packReport(gear, request, null);
  const lines = [
    `Hyked — ${route?.name || request.region || "My trip"}`,
    `${route?.distanceMiles ?? request.distanceMiles ?? "—"} mi · ${request.days ?? "—"} ${request.days === 1 ? "day" : "days"}`,
    request.startDate || "Dates to decide",
    `${report.complete ? "Calculated starting pack" : "Known weight so far (incomplete)"}: ${formatPackWeight(report.loadedLb * 16, units)}`,
    `Base gear: ${formatPackWeight(report.baseLb * 16, units)}`,
    `Food, water & fuel: ${formatPackWeight(report.suppliesLb * 16, units)}`,
    `Worn separately: ${formatPackWeight(report.wornLb * 16, units)}`,
    ...(report.unknown.length ? [`Missing weights: ${report.unknown.join(", ")}`] : []),
    ...(report.missingSupplies.length ? [`Missing supplies: ${report.missingSupplies.join(", ")}`] : []),
  ];
  lines.push("", "Weight breakdown (known carried weight)", ...weightBreakdown(gear, request, true).map(slice => `${slice.label}: ${formatPackWeight(slice.oz, units)}${slice.missing ? " — incomplete" : ""}`));
  for (const step of packingGuide(gear, request)) {
    lines.push("", `${step.zone} — ${step.title}`, step.guidance, ...step.tips.map(tip => `• ${tip}`));
    for (const item of step.items) {
      const weight = gearWeightOz(item);
      lines.push(`[${packed.includes(item.id) ? "x" : " "}] ${item.name}${item.qty > 1 ? ` ×${item.qty}` : ""} — ${weight === null ? "Weight unknown" : formatPackWeight(weight, units, true)}${item.packedSize ? ` · ${item.packedSize}` : ""}`);
    }
  }
  if (!gear.length) lines.push("No equipment added yet.");
  if (!request.suppliesInGear) lines.push("", "Additional starting supplies (separate from item checklist)", `Food: ${request.foodOzPerDay ?? "Not set"} oz/day`, `Water: ${request.waterLiters ?? "Not set"} liters`, `Fuel: ${request.fuelOz ?? "Not set"} oz`);
  lines.push("", "Before you head out", ...preparationChecks(request).map(check => `[ ] ${check}`), "", `Packing guide: ${REFERENCES.packing}`, `Ten Essentials: ${REFERENCES.essentials}`);
  if (route?.sourceUrl) lines.push(`Route source: ${route.sourceUrl}`);
  return lines.join("\n") + "\n";
}
