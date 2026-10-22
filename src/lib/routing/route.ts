import { metersBetween, MILE_METERS } from "@/lib/geo/line";
import { CONNECTOR, JUNCTION, snapCandidates, type LngLat, type Snap, type TrailGraph } from "./graph";

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
    throw new RouteError(NO_CONNECTION);
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

/** A walking route between two points over real roads and paths (OSRM foot profile), or null when there is none. */
export type RoadConnector = (from: LngLat, to: LngLat) => Promise<{ coordinates: LngLat[]; meters: number } | null>;

export interface RouteOptions {
  maxSnap?: number;
  /** "Allow road connectors": bridges gaps between trail networks with this walking road route. */
  connect?: RoadConnector;
}

/** Longest straight-line gap a road connector may bridge. */
export const MAX_CONNECTOR_M = 5000;

const NO_CONNECTION = "No trail connection between these points. Add a waypoint on a trail that links them, or turn on road connectors.";

/** A snap sitting exactly on a node, for joining a road connector to the trail network. */
function snapAtNode(g: TrailGraph, n: number): Snap {
  return { u: n, v: g.adj[n][0]?.to ?? n, t: 0, point: g.nodes[n], meters: 0 };
}

/** The closest pair of nodes between two connected pieces: dead ends and junctions of one, any node of the other. */
function closestBetween(g: TrailGraph, fromComp: number, toComp: number, near: LngLat): [number, number] | null {
  const CELL = 0.01; // ~1 km
  const grid = new Map<string, number[]>();
  const ends: number[] = [];
  for (let n = 0; n < g.nodes.length; n++) {
    if (g.comp[n] === toComp) {
      const k = `${Math.floor(g.nodes[n][0] / CELL)}:${Math.floor(g.nodes[n][1] / CELL)}`;
      const list = grid.get(k);
      if (list) list.push(n); else grid.set(k, [n]);
    } else if (g.comp[n] === fromComp && g.adj[n].length !== 2) ends.push(n);
  }
  let best: [number, number] | null = null, bestM = MAX_CONNECTOR_M, bestScore = Infinity;
  const rings = Math.ceil(MAX_CONNECTOR_M / 550);
  for (const u of ends) {
    const p = g.nodes[u], cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL);
    for (let x = cx - rings; x <= cx + rings; x++) for (let y = cy - rings; y <= cy + rings; y++)
      for (const v of grid.get(`${x}:${y}`) ?? []) {
        const m = metersBetween(p, g.nodes[v]);
        // Shortest gap first; among similar gaps, the one closer to where the hiker is heading.
        const score = m + 0.1 * metersBetween(g.nodes[v], near);
        if (m <= bestM * 1.5 && score < bestScore) { bestScore = score; bestM = Math.min(bestM, m); best = [u, v]; }
      }
  }
  return best;
}

async function connectedLeg(g: TrailGraph, a: Snap, b: Snap, connect?: RoadConnector): Promise<Part[]> {
  if (g.comp[a.u] === g.comp[b.u]) return leg(g, a, b);
  if (!connect) throw new RouteError(NO_CONNECTION);
  const pair = closestBetween(g, g.comp[a.u], g.comp[b.u], b.point);
  if (!pair) throw new RouteError("These trails are more than 3 mi apart with no trail between them. Add a closer waypoint.");
  const road = await connect(g.nodes[pair[0]], g.nodes[pair[1]]);
  if (!road || road.coordinates.length < 2) throw new RouteError("No trail or walking road connection was found between these points.");
  return [...leg(g, a, snapAtNode(g, pair[0])), { trail: CONNECTOR, meters: road.meters, coords: road.coordinates }, ...leg(g, snapAtNode(g, pair[1]), b)];
}

/**
 * Snaps each point to the trail network. Every point goes on the same connected piece when one lies within
 * reach of all of them (the nearest such piece); otherwise each takes its nearest trail and the gaps need road
 * connectors.
 */
function chooseSnaps(g: TrailGraph, points: LngLat[], maxSnap: number): Snap[] {
  const options = points.map((p, i) => {
    const list = snapCandidates(g, p, maxSnap);
    if (!list.length) throw new RouteError(`${i === 0 ? "The start" : i === points.length - 1 ? "The end" : `Waypoint ${i}`} is more than ${Math.round(maxSnap / 160.9) / 10} mi from a mapped trail. Choose a point on or near a trail.`);
    return list;
  });
  let best: Snap[] | null = null, bestM = Infinity;
  for (const first of options[0]) {
    const comp = g.comp[first.u];
    const pick = options.map((list) => list.find((s) => g.comp[s.u] === comp));
    if (pick.every(Boolean)) {
      const m = pick.reduce((t, s) => t + s!.meters, 0);
      if (m < bestM) { bestM = m; best = pick as Snap[]; }
    }
  }
  return best ?? options.map((list) => list[0]);
}

/** Route through the points in order (start, waypoints…, end) along the trail graph. */
export async function routeThrough(g: TrailGraph, points: LngLat[], options: RouteOptions = {}): Promise<TrailRoute> {
  if (points.length < 2) throw new RouteError("Choose a start and an end.");
  const snaps = chooseSnaps(g, points, options.maxSnap ?? MAX_SNAP_M);
  const parts: Part[] = [];
  const legEnds: number[] = [];
  let total = 0;
  for (let i = 0; i + 1 < snaps.length; i++) {
    for (const p of await connectedLeg(g, snaps[i], snaps[i + 1], options.connect)) {
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
    const id = t?.id ?? null, name = t?.name ?? "Road connector (walking route on roads)";
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
