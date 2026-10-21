import type * as maplibregl from "maplibre-gl";
import type { TrailSectionKey } from "@/lib/trail-catalog/activity";

export type Line = [number, number][];
export interface OsmTrail {
  id: string;
  name: string | null;
  lines: Line[];
  tags: Record<string, unknown>;
  origin: "basemap" | "ski";
}

const R = 6371000;
export function meters(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function lengthKm(lines: Line[]) {
  let m = 0;
  for (const l of lines) for (let i = 1; i < l.length; i++) m += meters(l[i - 1], l[i]);
  return m / 1000;
}
export function geometryLines(g: GeoJSON.Geometry | null | undefined): Line[] {
  if (!g) return [];
  if (g.type === "LineString") return [g.coordinates as Line];
  if (g.type === "MultiLineString") return g.coordinates as Line[];
  return [];
}
export const featureKey = (f: { id?: string | number; properties?: Record<string, unknown> | null }) =>
  String(f.id ?? f.properties?.id ?? f.properties?.osm_id ?? "");

export const normalizeName = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Join tile pieces that share the tapped piece's name and touch it (ends within 30 m). */
export function buildFromTiles(map: maplibregl.Map, tapped: maplibregl.MapGeoJSONFeature | GeoJSON.Feature): OsmTrail {
  const id = featureKey(tapped as never);
  const name = (tapped.properties?.name as string | undefined) || null;
  const start = geometryLines(tapped.geometry);
  if (!name) return { id, name: null, lines: start, tags: { ...tapped.properties }, origin: "basemap" };
  const pieces = map.querySourceFeatures("trails", { sourceLayer: "trail" })
    .filter((f) => f.properties?.name === name)
    .map((f) => ({ key: featureKey(f), lines: geometryLines(f.geometry) }))
    .filter((p) => p.lines.length);
  const seen = new Set<string>([id]);
  const lines: Line[] = [...start];
  const ends = () => lines.flatMap((l) => [l[0], l[l.length - 1]]);
  let grew = true;
  while (grew) {
    grew = false;
    const e = ends();
    for (const p of pieces) {
      const sig = `${p.key}:${p.lines[0][0].join(",")}`;
      if (seen.has(sig) || seen.has(p.key) && p.key === id) continue;
      const pe = p.lines.flatMap((l) => [l[0], l[l.length - 1]]);
      if (pe.some((a) => e.some((b) => meters(a, b) <= 30))) { seen.add(sig); lines.push(...p.lines); grew = true; }
    }
  }
  return { id, name, lines, tags: { ...tapped.properties }, origin: "basemap" };
}

const MTB: Record<string, string> = { "0": "easy", "1": "easy", "2": "intermediate", "3": "difficult", "4": "extreme", "5": "extreme", "6": "extreme" };
const IMBA: Record<string, string> = { "0": "easy", "1": "easy", "2": "intermediate", "3": "difficult", "4": "extreme" };
export function osmDifficulty(tags: Record<string, unknown>): string | null {
  const d = tags.difficulty; if (typeof d === "string" && d) return d;
  const imba = tags["mtb:scale:imba"]; if (imba != null && IMBA[String(imba)]) return IMBA[String(imba)];
  const mtb = tags["mtb:scale"]; if (mtb != null) { const k = String(mtb).replace(/[+-]/g, ""); if (MTB[k]) return MTB[k]; }
  const sac = tags.sac_scale; if (typeof sac === "string") return sac.replace(/_/g, " ");
  return null;
}
const PAVED = /^(paved|asphalt|concrete|paving_stones|sett)/;
export function osmSections(tags: Record<string, unknown>): TrailSectionKey[] {
  const s = (k: string) => (tags[k] == null ? "" : String(tags[k]));
  const out: TrailSectionKey[] = [];
  if (!["no", "private"].includes(s("foot"))) out.push("foot");
  const bikeOk = ["yes", "designated", "permissive"].includes(s("bicycle"));
  const paved = PAVED.test(s("surface"));
  if (tags["mtb:scale"] != null || tags["mtb:scale:imba"] != null || (bikeOk && !paved) || (s("highway") === "cycleway" && paved) || (bikeOk && paved)) out.push("bike");
  if (["yes", "designated"].includes(s("horse"))) out.push("horse");
  return out;
}
/** Expression used to hide base-map trail lines outside the chosen section. */
export function sectionExpression(section: TrailSectionKey): maplibregl.ExpressionSpecification {
  if (section === "foot") return ["!", ["in", ["coalesce", ["get", "foot"], ""], ["literal", ["no", "private"]]]];
  if (section === "bike") return ["any", ["has", "mtb:scale"], ["has", "mtb:scale:imba"], ["==", ["get", "highway"], "cycleway"], ["in", ["coalesce", ["get", "bicycle"], ""], ["literal", ["yes", "designated", "permissive"]]]];
  if (section === "horse") return ["in", ["coalesce", ["get", "horse"], ""], ["literal", ["yes", "designated"]]];
  return ["==", 1, 0];
}

export function trailGpx(name: string, lines: Line[]) {
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
  const segs = lines.map((l) => `<trkseg>${l.map(([x, y]) => `<trkpt lat="${y}" lon="${x}"/>`).join("")}</trkseg>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Hyked" xmlns="http://www.topografix.com/GPX/1/1"><metadata><copyright author="OpenStreetMap contributors"/></metadata><trk><name>${esc(name)}</name>${segs}</trk></gpx>`;
}

const KEY = (id: string) => `hyked:osm-trail:${id}`;
export function saveOsmTrail(t: OsmTrail) { try { sessionStorage.setItem(KEY(t.id), JSON.stringify(t)); } catch { /* storage full */ } }
export function loadOsmTrail(id: string): OsmTrail | null { try { const v = sessionStorage.getItem(KEY(id)); return v ? JSON.parse(v) : null; } catch { return null; } }
export function osmTrailHref(t: OsmTrail) {
  const p = t.lines[0]?.[Math.floor((t.lines[0]?.length ?? 1) / 2)];
  const q = p ? `?lng=${p[0].toFixed(5)}&lat=${p[1].toFixed(5)}` : "";
  return `/trail/osm/${encodeURIComponent(t.id)}${q}`;
}

/** Sample the Terrarium DEM along the line: returns [distanceKm, elevationM]. */
export async function sampleElevation(lines: Line[], samples = 80): Promise<[number, number][]> {
  const pts: { d: number; p: [number, number] }[] = [];
  let d = 0;
  for (const l of lines) for (let i = 0; i < l.length; i++) { if (i) d += meters(l[i - 1], l[i]) / 1000; pts.push({ d, p: l[i] }); }
  if (!pts.length) return [];
  const step = Math.max(1, Math.floor(pts.length / samples));
  const picks = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const z = 13, n = 2 ** z;
  const tiles = new Map<string, Promise<ImageData | null>>();
  const tile = (x: number, y: number) => {
    const k = `${x}/${y}`;
    if (!tiles.has(k)) tiles.set(k, new Promise((res) => {
      const img = new Image(); img.crossOrigin = "anonymous";
      img.onload = () => { const c = document.createElement("canvas"); c.width = c.height = 256; const ctx = c.getContext("2d")!; ctx.drawImage(img, 0, 0); res(ctx.getImageData(0, 0, 256, 256)); };
      img.onerror = () => res(null);
      img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
    }));
    return tiles.get(k)!;
  };
  const out: [number, number][] = [];
  for (const { d: dist, p: [lng, lat] } of picks) {
    const fx = ((lng + 180) / 360) * n;
    const fy = ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
    const data = await tile(Math.floor(fx), Math.floor(fy));
    if (!data) continue;
    const px = Math.min(255, Math.floor((fx % 1) * 256)), py = Math.min(255, Math.floor((fy % 1) * 256));
    const i = (py * 256 + px) * 4;
    out.push([dist, data.data[i] * 256 + data.data[i + 1] + data.data[i + 2] / 256 - 32768]);
  }
  return out;
}
