import type { CatalogTrail } from "@/lib/trail-catalog/types";
import type { WaterReport } from "./water";
import type { TownNearTrail, TownServices } from "./towns";
import type { ElevationProfile } from "./elevation";
import type { TownDayPlan } from "./town-days";
import { SERVICE_LABELS, TOWNS_ATTRIBUTION, type ServiceKey } from "./towns";

export interface PackItem { name: string; quantity?: number; weightOz?: number | null; category?: string | null; consumable?: boolean }
export interface TripBundle {
  trail: CatalogTrail;
  lines: [number, number][][];
  water: WaterReport | null;
  towns: (TownNearTrail & { services: TownServices | null })[];
  elevation: ElevationProfile | null;
  plan: TownDayPlan | null;
  pack: PackItem[];
  siteUrl: string;
  generatedAt: string;
}

const xml = (v: unknown) => String(v ?? "").replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
const html = xml;
const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const WATER_LABEL = { tap: "Drinking water tap", spring: "Spring", river: "River", stream: "Stream", lake: "Lake or pond" } as const;
const RELIABILITY = { potable: "Mapped as drinking water", treat: "Treat or filter", seasonal: "Seasonal — may be dry" } as const;

/** GPX 1.1: the trail as a track, water sources and towns as waypoints. */
export function tripGpx(b: TripBundle) {
  const wpts = [
    ...(b.water?.sources ?? []).map((s) => `<wpt lat="${s.latitude}" lon="${s.longitude}"><name>${xml(`Mi ${s.mile} ${s.name ?? WATER_LABEL[s.kind]}`)}</name><desc>${xml(`${WATER_LABEL[s.kind]}${s.crossing ? " crossing" : ""}. ${RELIABILITY[s.reliability]}.`)}</desc><sym>Drinking Water</sym><type>water</type></wpt>`),
    ...b.towns.map((t) => `<wpt lat="${t.latitude}" lon="${t.longitude}"><name>${xml(`${t.name}, ${t.state}`)}</name><desc>${xml(`Town ${t.milesOffTrail} mi off trail near mile ${t.trailMile}. ${serviceList(t.services).join(", ") || "Services not checked"}.`)}</desc><sym>City (Small)</sym><type>town</type></wpt>`),
    ...(b.trail.trailhead ? [`<wpt lat="${b.trail.trailhead.latitude}" lon="${b.trail.trailhead.longitude}"><name>${xml(b.trail.trailhead.name ?? "Trailhead")}</name><sym>Trail Head</sym><type>trailhead</type></wpt>`] : []),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Hyked" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${xml(b.trail.name)}</name><desc>${xml("Generalized trail geometry with water and town waypoints from Hyked. Verify the route, water and access with the land manager before travel.")}</desc><link href="${xml(`${b.siteUrl}/explore/trails/${encodeURIComponent(b.trail.id)}`)}"><text>Hyked trail page</text></link><time>${b.generatedAt}</time></metadata>
${wpts.join("\n")}
<trk><name>${xml(b.trail.name)}</name>${b.lines.map((line) => `<trkseg>${line.map(([lon, lat]) => `<trkpt lat="${lat}" lon="${lon}"/>`).join("")}</trkseg>`).join("")}</trk>
</gpx>
`;
}

export function waterCsv(b: TripBundle) {
  const rows = [["mile", "kind", "name", "crossing", "reliability", "off_trail_m", "latitude", "longitude"]];
  for (const s of b.water?.sources ?? []) rows.push([String(s.mile), WATER_LABEL[s.kind], s.name ?? "", s.crossing ? "yes" : "no", RELIABILITY[s.reliability], String(s.offTrailMeters), String(s.latitude), String(s.longitude)]);
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

const serviceList = (s: TownServices | null) => (s ? (Object.keys(SERVICE_LABELS) as ServiceKey[]).filter((k) => (s.counts[k] ?? 0) > 0).map((k) => SERVICE_LABELS[k]) : []);

/** A self-contained, printable trip packet. */
export function tripPacketHtml(b: TripBundle) {
  const t = b.trail;
  const e = b.elevation;
  const packWeight = b.pack.reduce((sum, i) => sum + (i.weightOz ?? 0) * (i.quantity ?? 1), 0);
  const section = (title: string, body: string) => `<section><h2>${html(title)}</h2>${body}</section>`;
  const facts = [
    ["Distance", t.miles != null ? `${t.miles.toFixed(1)} mi (${(t.miles * 1.609344).toFixed(1)} km)` : "Unknown"],
    ["Location", [t.region, t.country].filter(Boolean).join(", ")],
    ["Managed by", t.manager ?? "Not reported"],
    ...(e ? [["Elevation", `${e.minFt.toLocaleString()}–${e.maxFt.toLocaleString()} ft · +${e.gainFt.toLocaleString()} / −${e.lossFt.toLocaleString()} ft`]] : []),
    ...(t.trailhead ? [["Trailhead", `${t.trailhead.name ?? "Mapped trailhead"} (${t.trailhead.latitude}, ${t.trailhead.longitude})`]] : []),
    ["Source", t.sourceUrl],
  ];
  const water = b.water;
  const waterRows = (water?.sources ?? []).map((s) => `<tr><td>${s.mile}</td><td>${html(WATER_LABEL[s.kind])}${s.crossing ? " crossing" : ""}</td><td>${html(s.name ?? "")}</td><td>${html(RELIABILITY[s.reliability])}</td><td>${s.offTrailMeters ? `${s.offTrailMeters} m off` : "On trail"}</td></tr>`).join("");
  const townRows = b.towns.map((town) => `<tr><td>${town.trailMile}</td><td>${html(town.name)}, ${html(town.state)}</td><td>${town.milesOffTrail} mi</td><td>${html(serviceList(town.services).join(", ") || "Not checked")}</td></tr>`).join("");
  const plan = b.plan;
  const planBody = plan
    ? `<p>${html(plan.notes[0])}</p><p><strong>Start:</strong> carry ${plan.startFoodDays} day${plan.startFoodDays === 1 ? "" : "s"} (${plan.startFoodLb} lb) of food.</p>` +
      plan.stops.map((s) => `<div class="stop"><h3>Day ${s.arriveDay}${s.date ? ` · ${s.date}` : ""} — ${html(s.town.name)}, ${html(s.town.state)} <small>(mile ${s.trailMile}, ${s.town.milesOffTrail} mi off trail, ${s.kind === "zero" ? "zero day" : "half day"})</small></h3><ul class="check">${s.checklist.map((c) => `<li>${html(c)}</li>`).join("")}</ul>${s.warnings.map((w) => `<p class="warn">${html(w)}</p>`).join("")}</div>`).join("") +
      plan.gaps.map((g) => `<p class="warn">Miles ${g.fromMile}–${g.toMile} (${g.days} days) have no town within reach: mail a box or carry extra food.</p>`).join("")
    : "<p>Add a number of days to plan town stops.</p>";
  const packRows = b.pack.map((i) => `<tr><td>☐</td><td>${html(i.name)}</td><td>${i.quantity ?? 1}</td><td>${i.weightOz != null ? `${(i.weightOz * (i.quantity ?? 1)).toFixed(1)} oz` : ""}</td><td>${html(i.category ?? "")}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(t.name)} — Hyked trip packet</title>
<style>
:root{--ink:#1f2a24;--muted:#5d6b62;--line:#d9ded8;--accent:#2f6b4f;--warn:#9a5b13}
*{box-sizing:border-box}body{font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:var(--ink);margin:0;padding:24px;max-width:900px;margin-inline:auto;background:#fff}
h1{font-size:28px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 8px;padding-bottom:4px;border-bottom:2px solid var(--accent)}h3{font-size:15px;margin:16px 0 6px}small{color:var(--muted);font-weight:400}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600}
dl{display:grid;grid-template-columns:140px 1fr;gap:4px 16px;margin:0}dt{color:var(--muted)}dd{margin:0;word-break:break-word}
.check{list-style:none;padding:0;margin:0}.check li::before{content:"☐ ";}.warn{color:var(--warn)}.muted{color:var(--muted);font-size:12px}
.bar{display:flex;gap:8px;margin:12px 0 0}.bar button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
.stop{break-inside:avoid;border:1px solid var(--line);border-radius:10px;padding:8px 14px;margin:10px 0}
@media print{.bar{display:none}body{padding:0}section{break-inside:avoid-page}}
</style></head><body>
<header><h1>${html(t.name)}</h1><div class="muted">Hyked trip packet · generated ${b.generatedAt.slice(0, 10)}</div><div class="bar"><button onclick="print()">Print or save as PDF</button></div></header>
${section("Trail", `<dl>${facts.map(([k, v]) => `<dt>${html(k)}</dt><dd>${html(v)}</dd>`).join("")}</dl>`)}
${section("Town days & resupply", planBody)}
${section("Water", water ? `<p>${water.sources.length} sources mapped · longest stretch without dependable water: <strong>${water.longestDryMiles} mi</strong></p>${waterRows ? `<table><thead><tr><th>Mile</th><th>Source</th><th>Name</th><th>Reliability</th><th>Where</th></tr></thead><tbody>${waterRows}</tbody></table>` : ""}${water.notes.map((n) => `<p class="muted">${html(n)}</p>`).join("")}` : "<p>Water could not be checked.</p>")}
${section("Towns near the trail", townRows ? `<table><thead><tr><th>Trail mile</th><th>Town</th><th>Off trail</th><th>Services</th></tr></thead><tbody>${townRows}</tbody></table><p class="muted">${html(TOWNS_ATTRIBUTION)}</p>` : "<p>No towns within reach of this trail.</p>")}
${section("Pack list", packRows ? `<p>${b.pack.length} items · ${(packWeight / 16).toFixed(1)} lb listed weight</p><table><thead><tr><th></th><th>Item</th><th>Qty</th><th>Weight</th><th>Category</th></tr></thead><tbody>${packRows}</tbody></table>` : "<p>No pack list was included. Add your gear in Hyked to print it here.</p>")}
<p class="muted">Generalized map data for planning, not navigation. Confirm access, closures, permits, water and weather with the land manager. ${html(b.water?.attribution ?? "")} ${html(b.elevation?.attribution ?? "")}</p>
</body></html>
`;
}
