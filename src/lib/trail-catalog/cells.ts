/**
 * Trail geometry is stored in 1° geographic cells (file `geometry-<cell>.json.gz`), keyed by the cell
 * holding the trail's map pin, so a map view loads only the few cells it covers.
 */
export const CELL_DEGREES = 1;

export function geometryCell(longitude: number, latitude: number) {
  const x = Math.min(359, Math.max(0, Math.floor(longitude + 180)));
  const y = Math.min(179, Math.max(0, Math.floor(latitude + 90)));
  return `${String(x).padStart(3, "0")}_${String(y).padStart(3, "0")}`;
}

/** Cells covering a bounding box, plus `margin` cells around it for trails whose pin lies just outside. */
export function cellsInBounds([west, south, east, north]: [number, number, number, number], margin = 1, max = 64) {
  const x0 = Math.floor(west + 180) - margin, x1 = Math.floor(east + 180) + margin;
  const y0 = Math.max(0, Math.floor(south + 90) - margin), y1 = Math.min(179, Math.floor(north + 90) + margin);
  const out: string[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const wx = ((x % 360) + 360) % 360;
    out.push(`${String(wx).padStart(3, "0")}_${String(y).padStart(3, "0")}`);
    if (out.length >= max) return out;
  }
  return out;
}

export const isShardKey = (key: string) => /^(\d{2}|\d{3}_\d{3}|route)$/.test(key);
