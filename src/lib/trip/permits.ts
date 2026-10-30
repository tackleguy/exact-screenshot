/**
 * Where to get permits and reserve camping for a trail: official pages for well-known trails and parks (each URL
 * checked to exist when added), the land manager's own page when the catalog has one, and official reservation
 * searches by country. Links only, never requirements stated as fact: rules, quotas and seasons change, so every
 * list ends with "confirm on the official page".
 */
import type { CatalogTrail } from "@/lib/trail-catalog/types";

export interface PermitLink {
  label: string;
  url: string;
  /** "trail": a permit for the trail itself; "camping": campsite or hut booking; "park": the land manager's
   * backcountry rules; "search": an official reservation search. */
  kind: "trail" | "camping" | "park" | "search";
  note?: string;
}

type Known = { match: (t: Pick<CatalogTrail, "id" | "name" | "park">) => boolean; links: PermitLink[] };
const named = (re: RegExp) => (t: Pick<CatalogTrail, "name">) => re.test(t.name);
const inPark = (re: RegExp) => (t: Pick<CatalogTrail, "park">) => Boolean(t.park && re.test(t.park));

/** Official permit and booking pages for trails and parks that need them. */
const KNOWN: Known[] = [
  { match: (t) => t.id === "route-pct" || named(/pacific crest/i)(t), links: [{ label: "PCT long-distance permit (PCTA)", url: "https://www.pcta.org/discover-the-trail/permits/", kind: "trail", note: "For trips of 500 miles or more; shorter trips use local wilderness permits." }] },
  { match: (t) => t.id === "route-jmt" || named(/john muir trail/i)(t), links: [
    { label: "Yosemite wilderness permit (starting in Yosemite)", url: "https://www.recreation.gov/permits/445859", kind: "trail" },
    { label: "Inyo National Forest wilderness permit (starting on the east side)", url: "https://www.recreation.gov/permits/233262", kind: "trail" },
    { label: "Mount Whitney permit", url: "https://www.recreation.gov/permits/233260", kind: "trail", note: "Needed to exit over Mount Whitney." },
  ] },
  { match: named(/half dome/i), links: [{ label: "Half Dome cables permit", url: "https://www.recreation.gov/permits/234652", kind: "trail" }] },
  { match: named(/whitney/i), links: [{ label: "Mount Whitney permit", url: "https://www.recreation.gov/permits/233260", kind: "trail" }] },
  { match: named(/enchantment/i), links: [{ label: "Enchantment Permit Area (lottery)", url: "https://www.recreation.gov/permits/233273", kind: "trail" }] },
  { match: (t) => named(/narrows/i)(t) && inPark(/zion/i)(t), links: [{ label: "Zion Narrows permits and conditions", url: "https://www.nps.gov/zion/planyourvisit/thenarrows.htm", kind: "trail" }] },
  { match: (t) => named(/wonderland/i)(t) || inPark(/mount rainier/i)(t), links: [{ label: "Mount Rainier wilderness permits", url: "https://www.nps.gov/mora/planyourvisit/wilderness-permit.htm", kind: "park" }] },
  { match: inPark(/yosemite/i), links: [{ label: "Yosemite wilderness permits", url: "https://www.nps.gov/yose/planyourvisit/wildpermits.htm", kind: "park" }] },
  { match: inPark(/sequoia|kings canyon/i), links: [{ label: "Sequoia & Kings Canyon wilderness permits", url: "https://www.nps.gov/seki/planyourvisit/wilderness_permits.htm", kind: "park" }] },
  { match: inPark(/grand canyon/i), links: [{ label: "Grand Canyon backcountry permit", url: "https://www.nps.gov/grca/planyourvisit/backcountry-permit.htm", kind: "park" }] },
  { match: inPark(/great smoky/i), links: [{ label: "Great Smoky Mountains backcountry camping", url: "https://www.nps.gov/grsm/planyourvisit/backcountry-camping.htm", kind: "park" }] },
  { match: inPark(/glacier national park/i), links: [{ label: "Glacier backcountry camping", url: "https://www.nps.gov/glac/planyourvisit/backcountry.htm", kind: "park" }] },
  { match: inPark(/yellowstone/i), links: [{ label: "Yellowstone backcountry hiking and camping", url: "https://www.nps.gov/yell/planyourvisit/backcountryhiking.htm", kind: "park" }] },
  { match: (t) => t.id === "route-at" || named(/appalachian trail/i)(t), links: [{ label: "Appalachian Trail Conservancy (registration, shelters, rules)", url: "https://appalachiantrail.org/", kind: "trail" }] },
  { match: (t) => t.id === "route-ct" || named(/^colorado trail/i)(t), links: [{ label: "Colorado Trail Foundation", url: "https://coloradotrail.org/", kind: "trail", note: "No through-hike permit; wilderness areas along the way have their own rules." }] },
  { match: (t) => t.id === "route-cdt" || named(/continental divide/i)(t), links: [{ label: "Continental Divide Trail Coalition (permits by section)", url: "https://www.cdtcoalition.org/", kind: "trail" }] },
  { match: named(/milford track/i), links: [{ label: "Milford Track huts (DOC booking)", url: "https://www.doc.govt.nz/milfordtrack", kind: "camping" }] },
  { match: named(/tour du mont blanc/i), links: [{ label: "Tour du Mont Blanc refuge booking", url: "https://www.montourdumontblanc.com/", kind: "camping" }] },
];

const NATIONAL_PARK = /national (park|monument|recreation area|seashore|lakeshore|preserve)/i;

/** Permit and reservation links for a trail, most specific first, without duplicates. */
export function permitLinks(t: Pick<CatalogTrail, "id" | "name" | "park" | "forest" | "manager" | "country" | "officialUrl">): PermitLink[] {
  const out: PermitLink[] = [];
  for (const k of KNOWN) if (k.match(t)) out.push(...k.links);
  const area = t.park ?? t.forest ?? null;
  if (t.officialUrl) out.push({ label: `${t.park ?? t.forest ?? t.manager ?? "Land manager"}: official trail page`, url: t.officialUrl, kind: "park" });
  if (t.country === "US") {
    out.push({ label: `Recreation.gov: permits and campgrounds for ${area ?? t.name}`, url: `https://www.recreation.gov/search?q=${encodeURIComponent(area ?? t.name)}`, kind: "search", note: "The federal booking site for wilderness permits and reservable campsites." });
    if (t.park && NATIONAL_PARK.test(t.park)) out.push({ label: `${t.park}: backcountry permit information`, url: `https://www.nps.gov/search/?q=${encodeURIComponent(`${t.park} backcountry permit`)}`, kind: "search" });
  }
  if (t.country === "CA") out.push({ label: "Parks Canada reservations (backcountry and campgrounds)", url: "https://reservation.pc.gc.ca/", kind: "search" });
  if (t.country === "NZ") out.push({ label: "DOC bookings (huts and campsites)", url: "https://bookings.doc.govt.nz/", kind: "search" });
  const seen = new Set<string>();
  return out.filter((l) => !seen.has(l.url) && seen.add(l.url));
}

/** A campsite's booking or information link from its mapped details, if it has one. */
export function campsiteLink(extra: Record<string, string | number | boolean>): string | null {
  for (const key of ["reservation:website", "website", "contact:website", "url"]) {
    const v = extra[key];
    if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
  }
  return null;
}
