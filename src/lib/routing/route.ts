import { metersBetween, MILE_METERS } from "@/lib/geo/line";
import { CONNECTOR, JUNCTION, snapToGraph, type LngLat, type Snap, type TrailGraph } from "./graph";

export class RouteError extends Error {}

export interface RouteTrailUse { id: string | null; name: string; fromMile: number; toMile: number; connector?: boolean }
export interface TrailRoute {
  coordinates: LngLat[];
  meters: number;
  miles: number;
  /** Trails in the order walked, with the mile where each starts and ends. */
  trails: RouteTrailUse[];
  /** Each requested point as placed on the trail network, with how far off-trail it was. */
  snapped: { point: LngLat; offTrailMeters: number }[];
  /** Mile at the end of each leg (between consecutive points), for "remove this leg". */
  legEndsMile: number[];
  usesConnectors: boolean;
}

/** Max distance a tapped or searched point may be from a trail. */
export const MAX_SNAP_M = 1000;

class Heap {
  private a: [number, number][] = [];
  get size() { return this.a.length; }
  push(n: number, f: number) {
    const a = this.a; a.push([f, n]);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop(): [number, number] {
    const a = this.a, top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

interface Part { trail: number; meters: number; coords: LngLat[] }

/** Cost to reach each end of a snapped edge from the snap point (edge cost split by position). */
function edgeEnds(g: TrailGraph, s: Snap) {
  const e = g.adj[s.u].find((x) => x.to === s.v)!;
  return { trail: e.trail, costPerM: e.cost / Math.max(e.meters, 1e-9), toU: e.meters * s.t, toV: e.meters * (1 - s.t) };
}

/** Best path between two snapped points (A*, cost = meters × trail factor; heuristic = straight-line meters). */
function leg(g: TrailGraph, a: Snap, b: Snap): Part[] {
  const ea = edgeEnds(g, a), eb = edgeEnds(g, b);
  // Both points on the same edge: walk straight along it.
  const sameEdge = (a.u === b.u && a.v === b.v) || (a.u === b.v && a.v === b.u);
  let directCost = Infinity;
  if (sameEdge) directCost = metersBetween(a.point, b.point) * ea.costPerM;

  const n = g.nodes.length;
  const gCost = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const prevEdge: (number | null)[] = new Array(n).fill(null);
  const heap = new Heap();
  const target = b.point;
  const h = (i: number) => metersBetween(g.nodes[i], target);
  const seed = (node: number, cost: number) => { if (cost < gCost[node]) { gCost[node] = cost; prev[node] = -2; heap.push(node, cost + h(node)); } };
  seed(a.u, ea.toU * ea.costPerM);
  seed(a.v, ea.toV * ea.costPerM);
  const exitCost = new Map<number, number>([[b.u, eb.toU * eb.costPerM], [b.v, eb.toV * eb.costPerM]]);
  let best = directCost, bestNode = -1;
  const closed = new Uint8Array(n);
  while (heap.size) {
    const [f, u] = heap.pop();
    if (f >= best) break;
    if (closed[u]) continue;
    closed[u] = 1;
    const exit = exitCost.get(u);
    if (exit !== undefined && gCost[u] + exit < best) { best = gCost[u] + exit; bestNode = u; }
    for (const e of g.adj[u]) {
      const c = gCost[u] + e.cost;
      if (c < gCost[e.to]) { gCost[e.to] = c; prev[e.to] = u; prevEdge[e.to] = e.trail; heap.push(e.to, c + h(e.to)); }
    }
  }
  if (bestNode < 0) {
    if (sameEdge) return [{ trail: ea.trail, meters: metersBetween(a.point, b.point), coords: [a.point, b.point] }];
    throw new RouteError("No mapped trail connects these points. Add a waypoint on a connecting trail, or turn on road connectors.");
  }

  // Walk back from the exit node to a seed node.
  const path: number[] = [];
  for (let u = bestNode; u !== -2 && u !== -1; u = prev[u]) path.push(u);
  path.reverse();
  const parts: Part[] = [];
  const add = (trail: number, from: LngLat, to: LngLat) => {
    const meters = metersBetween(from, to);
    const last = parts[parts.length - 1];
    if (last && last.trail === trail) { last.meters += meters; last.coords.push(to); }
    else parts.push({ trail, meters, coords: [from, to] });
  };
  add(ea.trail, a.point, g.nodes[path[0]]);
  for (let i = 1; i < path.length; i++) add(prevEdge[path[i]]!, g.nodes[path[i - 1]], g.nodes[path[i]]);
  add(eb.trail, g.nodes[path[path.length - 1]], b.point);
  return parts;
}

/** Route through the points in order (start, waypoints…, end) along the trail graph. */
export function routeThrough(g: TrailGraph, points: LngLat[], maxSnap = MAX_SNAP_M): TrailRoute {
  if (points.length < 2) throw new RouteError("Choose a start and an end.");
  const snaps = points.map((p, i) => {
    const s = snapToGraph(g, p, maxSnap);
    if (!s) throw new RouteError(`${i === 0 ? "The start" : i === points.length - 1 ? "The end" : `Waypoint ${i}`} is more than ${Math.round(maxSnap / 160.9) / 10} mi from a mapped trail. Choose a point on or near a trail.`);
    return s;
  });
  const parts: Part[] = [];
  const legEnds: number[] = [];
  let total = 0;
  for (let i = 0; i + 1 < snaps.length; i++) {
    for (const p of leg(g, snaps[i], snaps[i + 1])) {
      const last = parts[parts.length - 1];
      if (last && last.trail === p.trail) { last.meters += p.meters; last.coords.push(...p.coords.slice(1)); }
      else parts.push(p);
      total += p.meters;
    }
    legEnds.push(Math.round((total / MILE_METERS) * 100) / 100);
  }

  // Junction hops belong to the trail before them; consecutive pieces of one trail merge.
  const uses: RouteTrailUse[] = [];
  const coordinates: LngLat[] = [];
  let at = 0;
  for (const p of parts) {
    const from = at / MILE_METERS;
    at += p.meters;
    const to = at / MILE_METERS;
    for (const c of p.coords) { const last = coordinates[coordinates.length - 1]; if (!last || last[0] !== c[0] || last[1] !== c[1]) coordinates.push(c); }
    if (p.trail === JUNCTION || p.meters < 1) { if (uses.length) uses[uses.length - 1].toMile = to; continue; }
    const t = p.trail >= 0 ? g.trails[p.trail] : null;
    const id = t?.id ?? null, name = t?.name ?? "Connector (not a mapped trail)";
    const last = uses[uses.length - 1];
    if (last && last.id === id && !(p.trail === CONNECTOR)) { last.toMile = to; continue; }
    uses.push({ id, name, fromMile: from, toMile: to, ...(p.trail === CONNECTOR ? { connector: true } : {}) });
  }
  if (uses.length && uses[0].fromMile > 0) uses[0].fromMile = 0;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    coordinates,
    meters: total,
    miles: round2(total / MILE_METERS),
    trails: uses.map((u) => ({ ...u, fromMile: round2(u.fromMile), toMile: round2(u.toMile) })),
    snapped: snaps.map((s) => ({ point: s.point, offTrailMeters: Math.round(s.meters) })),
    legEndsMile: legEnds,
    usesConnectors: parts.some((p) => p.trail === CONNECTOR),
  };
}
