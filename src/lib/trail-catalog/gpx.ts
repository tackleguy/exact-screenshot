import type { CatalogTrail } from "./types";

function xml(value: string) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
export function catalogGpx(trail: CatalogTrail, lines: [number, number][][]) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Hyked" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${xml(trail.name)}</name><desc>Generalized trail geometry joined from mapped source sections; gaps are unmapped. Verify the complete route, access and trailhead with the source before travel.</desc><link href="${xml(trail.sourceUrl)}"><text>Original source record</text></link></metadata><trk><name>${xml(trail.name)}</name>${lines.map(line => `<trkseg>${line.map(([lon, lat]) => `<trkpt lat="${lat}" lon="${lon}"/>`).join("")}</trkseg>`).join("")}</trk></gpx>\n`;
}
