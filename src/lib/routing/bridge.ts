/**
 * Joins the gaps in a trail's mapped line along real mapped paths. A trail often comes from the source in pieces
 * that don't touch (a missing junction, a stretch mapped under another name). For each gap, the trail network
 * around it (the route builder's graph, src/lib/routing) is searched for a path from one piece's end to the next
 * piece's start. Gaps no mapped path connects stay gaps: nothing is drawn across open ground.
 */
import { chainLines, metersBetween } from "@/lib/geo/line";
import type { LngLat } from "./graph";
import { graphFor } from "./index";
import { routeThrough } from "./route";
import type { NetworkTrail } from "./graph";

/** Gaps shorter than this are drawn as continuous already (the pieces meet). */
const TOUCHING_M = 25;
/** Longer gaps are separate sections, not something to join. */
const MAX_GAP_M = 2000;
/** A connecting path is accepted only when it isn't a long way round: at most 3× the gap, plus 400 m. */
const DETOUR = (gap: number) => gap * 3 + 400;

export interface TrailGap { from: LngLat; to: LngLat; meters: number }
export interface BridgedLine {
  /** Mapped paths that join gaps, to draw with the trail. */
  links: LngLat[][];
  /** Separate sections left after joining (1 when the whole trail now connects). */
  sections: number;
  /** Gaps between pieces before joining. */
  gaps: number;
}

/** The gaps between a trail's pieces, laid end to end, longer than touching. */
export function trailGaps(lines: LngLat[][]): TrailGap[] {
  const pieces = chainLines(lines);
  const out: TrailGap[] = [];
  for (let i = 1; i < pieces.length; i++) {
    const from = pieces[i - 1][pieces[i - 1].length - 1], to = pieces[i][0];
    const meters = metersBetween(from, to);
    if (meters > TOUCHING_M) out.push({ from, to, meters });
  }
  return out;
}

type Load = (box: [number, number, number, number]) => Promise<NetworkTrail[]>;

/** Joins what it can of a trail's gaps along mapped paths (at most 12 gaps are searched). */
export async function bridgeTrailGaps(lines: LngLat[][], options: { signal?: AbortSignal; load?: Load } = {}): Promise<BridgedLine> {
  const gaps = trailGaps(lines);
  const joinable = gaps.filter((g) => g.meters <= MAX_GAP_M).slice(0, 12);
  if (!joinable.length) return { links: [], sections: gaps.length + 1, gaps: gaps.length };
  const links: LngLat[][] = [];
  // Each gap is searched in the network around it (nearby gaps reuse the loaded area), so long trails work too.
  for (const g of joinable) {
    try {
      const graph = await graphFor([g.from, g.to], options.signal, options.load);
      const r = await routeThrough(graph, [g.from, g.to], { maxSnap: 40 });
      if (r.snapped.every((s) => s.offTrailMeters <= 40) && r.meters <= DETOUR(g.meters) && r.coordinates.length > 1) links.push(r.coordinates);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      // No mapped path joins this gap.
    }
  }
  return { links, sections: gaps.length - links.length + 1, gaps: gaps.length };
}
