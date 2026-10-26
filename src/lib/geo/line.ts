import { tileOf, type LngLat } from "./tiles";

export const MILE_METERS = 1609.344;
const RAD = Math.PI / 180;

export function metersBetween(a: LngLat, b: LngLat) {
  const h = Math.sin((b[1] - a[1]) * RAD / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin((b[0] - a[0]) * RAD / 2) ** 2;
  return 6_371_008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

/**
 * A trail's lines laid end to end with cumulative distance, so any nearby point can be placed at
 * "mile X". Pieces are taken in their stored order; gaps between pieces add no distance.
 */
export class Route {
  readonly points: LngLat[] = [];
  /** Cumulative meters at each point. */
  readonly along: number[] = [];
  /** Index where each piece starts (no segment joins a piece to the next). */
  private pieceStart = new Set<number>();

  constructor(lines: LngLat[][]) {
    let total = 0;
    for (const line of lines) {
      if (line.length < 2) continue;
      this.pieceStart.add(this.points.length);
      line.forEach((p, i) => {
        if (i > 0) total += metersBetween(line[i - 1], p);
        this.points.push(p);
        this.along.push(total);
      });
    }
  }

  get meters() { return this.along[this.along.length - 1] ?? 0; }

  /** Nearest point on the route: its distance along (m), distance off (m) and location. */
  locate(p: LngLat): { alongMeters: number; offMeters: number; at: LngLat } {
    let best = { alongMeters: 0, offMeters: Infinity, at: this.points[0] ?? p };
    const k = Math.cos(p[1] * RAD) * 111_320, ky = 110_540;
    for (let i = 1; i < this.points.length; i++) {
      if (this.pieceStart.has(i)) continue;
      const a = this.points[i - 1], b = this.points[i];
      const ax = (a[0] - p[0]) * k, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * k, by = (b[1] - p[1]) * ky;
      const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
      const t = len === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len));
      const off = Math.hypot(ax + t * dx, ay + t * dy);
      if (off < best.offMeters) {
        const at: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        best = { alongMeters: this.along[i - 1] + (this.along[i] - this.along[i - 1]) * t, offMeters: off, at };
      }
    }
    return best;
  }

  /** The location `meters` along the route (clamped to its ends). */
  pointAt(meters: number): LngLat | null {
    if (!this.points.length) return null;
    let lo = 0, hi = this.along.length - 1;
    if (meters <= 0) return this.points[0];
    if (meters >= this.meters) return this.points[hi];
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.along[mid] < meters) lo = mid; else hi = mid; }
    const span = this.along[hi] - this.along[lo], t = span ? (meters - this.along[lo]) / span : 0;
    const a = this.points[lo], b = this.points[hi];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  /** Points every `spacing` meters along the route (at most `max`), with their distance along. */
  sample(spacing: number, max = 600): { p: LngLat; alongMeters: number }[] {
    const step = Math.max(spacing, this.meters / max, 1);
    const out: { p: LngLat; alongMeters: number }[] = [];
    let next = 0;
    for (let i = 0; i < this.points.length; i++) {
      if (this.pieceStart.has(i)) {
        // A new piece starts where the last one stopped measuring; always include its first point.
        out.push({ p: this.points[i], alongMeters: this.along[i] });
        next = this.along[i] + step;
        continue;
      }
      const a = this.points[i - 1], b = this.points[i], s0 = this.along[i - 1], s1 = this.along[i];
      if (s1 <= s0) continue;
      while (next <= s1) {
        const t = (next - s0) / (s1 - s0);
        out.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], alongMeters: next });
        next += step;
      }
    }
    const last = this.points[this.points.length - 1];
    if (last && out[out.length - 1]?.alongMeters !== this.meters) out.push({ p: last, alongMeters: this.meters });
    return out;
  }

  /** Map tiles the route passes through (plus a ring of neighbours when `pad`), capped at `max`. */
  tiles(z: number, pad = 0, max = 80): [number, number][] {
    const seen = new Map<string, [number, number]>();
    for (const { p } of this.sample(150, 2000)) {
      const [x, y] = tileOf(p, z);
      for (let dx = -pad; dx <= pad; dx++) for (let dy = -pad; dy <= pad; dy++) seen.set(`${x + dx}/${y + dy}`, [x + dx, y + dy]);
      if (seen.size >= max) break;
    }
    return [...seen.values()].slice(0, max);
  }
}

/** Where segment ab crosses segment cd, if it does. */
export function segmentIntersection(a: LngLat, b: LngLat, c: LngLat, d: LngLat): LngLat | null {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const denom = r[0] * s[1] - r[1] * s[0];
  if (denom === 0) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / denom;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + t * r[0], a[1] + t * r[1]] : null;
}

export const round = (n: number, places = 1) => Math.round(n * 10 ** places) / 10 ** places;

/**
 * Orders a trail's pieces end to end (reversing pieces as needed) so "mile X" counts along the trail.
 * Starts from the piece end farthest from the others and repeatedly takes the nearest unused piece.
 * Gaps between pieces are left as gaps; nothing is drawn across them.
 */
export function chainLines(lines: LngLat[][]): LngLat[][] {
  const pieces = lines.filter((l) => l.length >= 2);
  if (pieces.length <= 1) return pieces;
  const k = Math.cos(((pieces[0][0][1] + pieces[pieces.length - 1][0][1]) / 2) * Math.PI / 180);
  const d2 = (a: LngLat, b: LngLat) => ((a[0] - b[0]) * k) ** 2 + (a[1] - b[1]) ** 2;
  // The start is the endpoint whose nearest other endpoint is farthest away (a trail terminus).
  const ends = pieces.flatMap((line, i) => [{ i, p: line[0], first: true }, { i, p: line[line.length - 1], first: false }]);
  let start = ends[0], startScore = -1;
  if (ends.length <= 4000) {
    for (const e of ends) {
      let nearest = Infinity;
      for (const o of ends) if (o.i !== e.i) nearest = Math.min(nearest, d2(e.p, o.p));
      if (nearest > startScore) { startScore = nearest; start = e; }
    }
  }
  const used = new Uint8Array(pieces.length);
  const out: LngLat[][] = [];
  let current = start.first ? pieces[start.i] : [...pieces[start.i]].reverse();
  used[start.i] = 1;
  out.push(current);
  for (let n = 1; n < pieces.length; n++) {
    const tail = current[current.length - 1];
    let best = -1, bestD = Infinity, reverse = false;
    for (let i = 0; i < pieces.length; i++) {
      if (used[i]) continue;
      const a = d2(tail, pieces[i][0]), b = d2(tail, pieces[i][pieces[i].length - 1]);
      if (a < bestD) { bestD = a; best = i; reverse = false; }
      if (b < bestD) { bestD = b; best = i; reverse = true; }
    }
    used[best] = 1;
    current = reverse ? [...pieces[best]].reverse() : pieces[best];
    out.push(current);
  }
  return out;
}
