import { useEffect } from "react";
import type { CatalogTrail } from "@/lib/trail-catalog/types";
import { trailSacScale } from "@/lib/trail-catalog/types";
import { DIFFICULTY_LABELS, resolveDifficulty } from "@/lib/trail-difficulty";
import { join, miles as fmtMiles, text } from "@/lib/display";

/**
 * Per-page <title>, meta description, Open Graph tags and schema.org JSON-LD for the client-rendered app.
 * Crawlers that run JavaScript (Google, Bing) read these; see DECISIONS.md for prerendering trade-offs.
 */
export interface PageMeta {
  title: string;
  description?: string | null;
  image?: string | null;
  jsonLd?: Record<string, unknown> | null;
}

function setMeta(attr: "name" | "property", key: string, value: string | null | undefined) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!value) { el?.remove(); return; }
  if (!el) { el = document.createElement("meta"); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.content = value;
}

export function applyPageMeta({ title, description, image, jsonLd }: PageMeta) {
  document.title = title;
  setMeta("name", "description", description ?? null);
  setMeta("property", "og:title", title);
  setMeta("property", "og:description", description ?? null);
  setMeta("property", "og:image", image ?? null);
  let script = document.getElementById("page-jsonld");
  if (!jsonLd) { script?.remove(); return; }
  if (!script) { script = document.createElement("script"); script.id = "page-jsonld"; script.setAttribute("type", "application/ld+json"); document.head.appendChild(script); }
  script.textContent = JSON.stringify(jsonLd);
}

export function usePageMeta(meta: PageMeta | null) {
  const key = meta ? JSON.stringify(meta) : null;
  useEffect(() => {
    if (key) applyPageMeta(JSON.parse(key) as PageMeta);
  }, [key]);
}


const ROUTE_WORD: Record<string, string> = { loop: "loop", "point-to-point": "point-to-point", network: "network of connected" };

/** "Mist Trail — Yosemite National Park, California · 3.4 mi · Hard | Hyked" plus description and schema.org Place. */
export function trailPageMeta(t: CatalogTrail): PageMeta {
  const difficulty = DIFFICULTY_LABELS[resolveDifficulty({ reported: t.difficulty, miles: t.miles, sacScale: trailSacScale(t) }).difficulty];
  const place = join([t.park ?? t.forest, t.region]);
  const length = fmtMiles(t.miles);
  const title = `${t.name}${place ? ` — ${place}` : ""}${length ? ` · ${length}` : ""} · ${difficulty} | Hyked`;
  const description = text(t.wiki?.extract)?.slice(0, 155) ?? join([
    `${t.name} is a ${length ? `${length} ` : ""}${t.routeType ? `${ROUTE_WORD[t.routeType] ?? ""} ` : ""}trail${place ? ` in ${place}` : ""}.`,
    `Difficulty: ${difficulty}.`,
    "Map, elevation profile, forecast and directions.",
  ], " ");
  return {
    title,
    description,
    image: t.wiki?.image?.url ?? null,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": ["Place", "TouristAttraction"],
      name: t.name,
      ...(description ? { description } : {}),
      geo: { "@type": "GeoCoordinates", latitude: t.latitude, longitude: t.longitude },
      ...(t.region ? { address: { "@type": "PostalAddress", addressRegion: t.region, addressCountry: t.country } } : {}),
      ...(t.park || t.forest ? { containedInPlace: { "@type": "Place", name: t.park ?? t.forest } } : {}),
      ...(t.wiki?.image?.url ? { image: t.wiki.image.url } : {}),
      ...(t.wiki?.url ? { sameAs: [t.wiki.url, ...(t.osm ? [`https://www.openstreetmap.org/relation/${t.osm.relation}`] : [])] } : {}),
      url: typeof window !== "undefined" ? `${window.location.origin}/explore/trails/${encodeURIComponent(t.id)}` : undefined,
    },
  };
}

const DEFAULT_META: PageMeta = { title: "Hyked — Trails, Maps & Adventure", description: "Find real, verified trails across the U.S. and Canada, see water and campsites by mile, build routes and plan your trip." };
const ROUTE_META: [RegExp, PageMeta][] = [
  [/^\/(explore\/trails|map)\/?$/, { title: "Trail map | Hyked", description: "Topographic trail map of the U.S. and Canada with water, campsites and a route builder." }],
  [/^\/explore\/trails\/catalog/, { title: "Trail catalog | Hyked", description: "Search verified and mapped trails near you by name, park or region." }],
  [/^\/plan/, { title: "Plan a trip | Hyked", description: "Build a trip around a trail, prepare your gear and get a pack list." }],
  [/^\/gear/, { title: "Your gear | Hyked", description: "Your gear closet and pack weights." }],
  [/^\/login/, { title: "Log in | Hyked" }],
  [/^\/signup/, { title: "Create an account | Hyked", description: "Save trips, gear and routes to your account so they're on every device." }],
  [/^\/you/, { title: "Your profile | Hyked" }],
  [/^\/record/, { title: "Record an outing | Hyked" }],
  [/^\/activit/, { title: "Activity log | Hyked", description: "Your recorded hikes, runs, rides and ski days." }],
  [/^\/ski-areas/, { title: "Ski areas | Hyked", description: "Ski areas and winter resorts with their mapped runs." }],
  [/^\/explore\/ski/, { title: "Nordic ski trails | Hyked" }],
  [/^\/trails\/?$/, { title: "Explore trails | Hyked" }],
  [/^\/my\/trails/, { title: "My trail | Hyked" }],
];

/** Default title and description for each route; pages with their own meta (trail pages) override it. */
export function RouteMeta({ pathname }: { pathname: string }) {
  useEffect(() => {
    applyPageMeta(ROUTE_META.find(([re]) => re.test(pathname))?.[1] ?? DEFAULT_META);
  }, [pathname]);
  return null;
}
