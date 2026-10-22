import { metersBetween } from "@/lib/geo/line";

/**
 * Client-side trail routing (see DECISIONS.md, "Route builder"): a graph over the trail lines of the area, built
 * in the browser from the same verified and mapped trails the map shows.
 *
 * Topology is the trails' own: lines connect where they share a vertex. Two repairs close gaps the source data
 * or line generalization leaves, never more than JOIN_M: vertices closer than SNAP_M merge, and a line end within
 * JOIN_M of another line joins it at the nearest point. Lines that cross split at the crossing (generalized lines
 * can drop the shared junction vertex). Nothing else connects: the router never draws a link across open ground.
 * Gaps between trail networks can only be bridged by real road routing (OSRM, see route.ts), when the hiker asks.
 */
export type LngLat = [number, number];

export interface NetworkTrail {
  id: string;
  name: string;
  /** Quality score (src/lib/trail-catalog/score.ts); higher is preferred. */
  quality?: number | null;
  tier?: string | null;
  lines: LngLat[][];
}

/** Edge trail index: ≥0 a trail, JUNCTION a short topology join, CONNECTOR a road connection routed by OSRM. */
export const JUNCTION = -1;
export const CONNECTOR = -2;

export interface Edge { to: number; meters: number; cost: number; trail: number }

export interface TrailGraph {
  nodes: LngLat[];
  adj: Edge[][];
  trails: NetworkTrail[];
  /** Connected piece of the network each node belongs to. */
  comp: Int32Array;
  /** Segment index for snapping: cell → [from, to] node pairs. */
  segCells: Map<string, [number, number][]>;
}

export const SNAP_M = 10;
export const JOIN_M = 25;
const SEG_CELL = 0.002; // ~200 m
const NODE_CELL = 0.0003; // ~30 m

/** Cost per meter: verified and higher-quality trails are cheaper, so the router prefers them. */
export function trailFactor(t: NetworkTrail) {
  const q = Math.max(0, Math.min(100, Number(t.quality) || 0));
  return (t.tier === "verified" ? 1 : 1.15) * (1.25 - q / 400);
}

const key = (x: number, y: number) => `${x}:${y}`;
const cellOf = (v: number, size: number) => Math.floor(v / size);

/** Planar projection (meters) around a latitude, accurate to well under 1% across a few degrees. */
function scaleAt(lat: number) { return { kx: Math.cos((lat * Math.PI) / 180) * 111_320, ky: 110_540 }; }

/** Closest point of segment ab to p: [t, distance m, point]. */
export function projectOnSegment(p: LngLat, a: LngLat, b: LngLat): { t: number; meters: number; point: LngLat } {
  const { kx, ky } = scaleAt(p[1]);
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  return { t, meters: Math.hypot(ax + t * dx, ay + t * dy), point: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] };
}

function intersect(a: LngLat, b: LngLat, c: LngLat, d: LngLat): [number, number] | null {
  const r0 = b[0] - a[0], r1 = b[1] - a[1], s0 = d[0] - c[0], s1 = d[1] - c[1];
  const den = r0 * s1 - r1 * s0;
  if (den === 0) return null;
  const t = ((c[0] - a[0]) * s1 - (c[1] - a[1]) * s0) / den;
  const u = ((c[0] - a[0]) * r1 - (c[1] - a[1]) * r0) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t, u] : null;
}

interface Seg { line: number; a: LngLat; b: LngLat }

export function buildGraph(trails: NetworkTrail[]): TrailGraph {
  // Every line, with the trail it belongs to.
  const lines: { trail: number; pts: LngLat[] }[] = [];
  trails.forEach((t, trail) => { for (const pts of t.lines) if (pts.length > 1) lines.push({ trail, pts }); });

  // 1. Segment hash (padded by the join distance) to find crossings and line ends near other lines.
  const segs: Seg[] = [];
  const hash = new Map<string, number[]>();
  const padDeg = JOIN_M / 70_000;
  lines.forEach((l, line) => {
    for (let i = 0; i + 1 < l.pts.length; i++) {
      const a = l.pts[i], b = l.pts[i + 1], s = segs.length;
      segs.push({ line, a, b });
      for (let x = cellOf(Math.min(a[0], b[0]) - padDeg, SEG_CELL); x <= cellOf(Math.max(a[0], b[0]) + padDeg, SEG_CELL); x++)
        for (let y = cellOf(Math.min(a[1], b[1]) - padDeg, SEG_CELL); y <= cellOf(Math.max(a[1], b[1]) + padDeg, SEG_CELL); y++) {
          const k = key(x, y);
          const list = hash.get(k);
          if (list) list.push(s); else hash.set(k, [s]);
        }
    }
  });

  // Extra points inserted into segments: segment index → [t, point][].
  const splits = new Map<number, [number, LngLat][]>();
  const addSplit = (s: number, t: number, p: LngLat) => { const list = splits.get(s); if (list) list.push([t, p]); else splits.set(s, [[t, p]]); };

  // 2. Crossings between different lines.
  const tested = new Set<string>();
  for (const list of hash.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const s1 = segs[list[i]], s2 = segs[list[j]];
      if (s1.line === s2.line) continue;
      const pair = list[i] < list[j] ? `${list[i]}|${list[j]}` : `${list[j]}|${list[i]}`;
      if (tested.has(pair)) continue;
      tested.add(pair);
      const hit = intersect(s1.a, s1.b, s2.a, s2.b);
      if (!hit) continue;
      const p: LngLat = [s1.a[0] + hit[0] * (s1.b[0] - s1.a[0]), s1.a[1] + hit[0] * (s1.b[1] - s1.a[1])];
      addSplit(list[i], hit[0], p);
      addSplit(list[j], hit[1], p);
    }
  }

  // 3. Line ends within JOIN_M of another line join it at the nearest point.
  const joins: [LngLat, LngLat][] = [];
  lines.forEach((l, line) => {
    for (const end of [0, l.pts.length - 1]) {
      const p = l.pts[end];
      let best: { s: number; t: number; meters: number; point: LngLat } | null = null;
      for (const s of hash.get(key(cellOf(p[0], SEG_CELL), cellOf(p[1], SEG_CELL))) ?? []) {
        if (segs[s].line === line) continue;
        const hit = projectOnSegment(p, segs[s].a, segs[s].b);
        if (hit.meters <= JOIN_M && (!best || hit.meters < best.meters)) best = { s, ...hit };
      }
      if (!best) continue;
      addSplit(best.s, best.t, best.point);
      if (best.meters > SNAP_M / 2) joins.push([p, best.point]);
    }
  });

  // 4. Nodes: vertices within SNAP_M merge.
  const nodes: LngLat[] = [];
  const adj: Edge[][] = [];
  const nodeHash = new Map<string, number[]>();
  const nodeAt = (p: LngLat) => {
    const cx = cellOf(p[0], NODE_CELL), cy = cellOf(p[1], NODE_CELL);
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++)
      for (const n of nodeHash.get(key(x, y)) ?? []) if (metersBetween(nodes[n], p) <= SNAP_M) return n;
    const n = nodes.length;
    nodes.push(p);
    adj.push([]);
    const k = key(cx, cy);
    const list = nodeHash.get(k);
    if (list) list.push(n); else nodeHash.set(k, [n]);
    return n;
  };
  const link = (u: number, v: number, trail: number, factor: number) => {
    if (u === v) return;
    const meters = metersBetween(nodes[u], nodes[v]);
    adj[u].push({ to: v, meters, cost: meters * factor, trail });
    adj[v].push({ to: u, meters, cost: meters * factor, trail });
  };

  const factors = trails.map(trailFactor);
  let s = 0;
  lines.forEach((l) => {
    let prev = nodeAt(l.pts[0]);
    for (let i = 0; i + 1 < l.pts.length; i++, s++) {
      const extra = (splits.get(s) ?? []).sort((x, y) => x[0] - y[0]);
      for (const [, p] of extra) { const n = nodeAt(p); link(prev, n, l.trail, factors[l.trail]); prev = n; }
      const n = nodeAt(l.pts[i + 1]);
      link(prev, n, l.trail, factors[l.trail]);
      prev = n;
    }
  });
  for (const [a, b] of joins) link(nodeAt(a), nodeAt(b), JUNCTION, 1);

  // Connected pieces.
  const comp = new Int32Array(nodes.length).fill(-1);
  let c = 0;
  for (let i = 0; i < nodes.length; i++) {
    if (comp[i] !== -1) continue;
    const stack = [i];
    comp[i] = c;
    while (stack.length) { const u = stack.pop()!; for (const e of adj[u]) if (comp[e.to] === -1) { comp[e.to] = c; stack.push(e.to); } }
    c++;
  }

  // Snapping index over every edge (each undirected edge once).
  const segCells = new Map<string, [number, number][]>();
  adj.forEach((edges, u) => {
    for (const e of edges) {
      if (e.to < u) continue;
      const a = nodes[u], b = nodes[e.to];
      for (let x = cellOf(Math.min(a[0], b[0]), SEG_CELL); x <= cellOf(Math.max(a[0], b[0]), SEG_CELL); x++)
        for (let y = cellOf(Math.min(a[1], b[1]), SEG_CELL); y <= cellOf(Math.max(a[1], b[1]), SEG_CELL); y++) {
          const k = key(x, y);
          const list = segCells.get(k);
          if (list) list.push([u, e.to]); else segCells.set(k, [[u, e.to]]);
        }
    }
  });
  return { nodes, adj, trails, comp, segCells };
}

export interface Snap { u: number; v: number; t: number; point: LngLat; meters: number }

/**
 * The nearest point on each connected piece of the network within `maxMeters`, nearest first (at most `limit`).
 * The router uses the nearest piece that actually reaches the other points, so a tap beside a short, isolated
 * stub still routes on the connected trail next to it.
 */
export function snapCandidates(g: TrailGraph, p: LngLat, maxMeters = 1000, limit = 4): Snap[] {
  const cx = cellOf(p[0], SEG_CELL), cy = cellOf(p[1], SEG_CELL);
  const rings = Math.ceil(maxMeters / (SEG_CELL * 55_000)) + 1;
  const best = new Map<number, Snap>();
  const seen = new Set<string>();
  for (let r = 0; r <= rings; r++) {
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) {
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
      for (const [u, v] of g.segCells.get(key(x, y)) ?? []) {
        const id = `${u}:${v}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const hit = projectOnSegment(p, g.nodes[u], g.nodes[v]);
        if (hit.meters > maxMeters) continue;
        const prev = best.get(g.comp[u]);
        if (!prev || hit.meters < prev.meters) best.set(g.comp[u], { u, v, t: hit.t, point: hit.point, meters: hit.meters });
      }
    }
    // Pieces found closer than this ring (~110 m per ring up to 60° N) can't be beaten by farther rings.
    const reach = r * SEG_CELL * 55_000;
    if ([...best.values()].filter((s) => s.meters < reach).length >= limit) break;
  }
  return [...best.values()].sort((a, b) => a.meters - b.meters).slice(0, limit);
}

/** The nearest point on any trail within `maxMeters`. */
export function snapToGraph(g: TrailGraph, p: LngLat, maxMeters = 1000): Snap | null {
  return snapCandidates(g, p, maxMeters, 1)[0] ?? null;
}
