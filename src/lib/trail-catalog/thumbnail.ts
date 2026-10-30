/**
 * Small static map picture of a trail's area for list cards (Esri World Topographic Map export): the trail's
 * extent when known, otherwise about 2 km around its start.
 */
function box(t: { bounds?: [number, number, number, number]; latitude: number; longitude: number }, width: number, height: number, margin: number, minHalf: number) {
  const [w, s, e, n] = t.bounds ?? [t.longitude - 0.012, t.latitude - 0.009, t.longitude + 0.012, t.latitude + 0.009];
  const cx = (w + e) / 2, cy = (s + n) / 2;
  const cos = Math.max(0.2, Math.cos((cy * Math.PI) / 180));
  const halfX = Math.min(20, Math.max(minHalf, (e - w) / 2, ((n - s) / 2 / cos) * (width / height)) * margin);
  const halfY = (halfX * cos * height) / width;
  return [cx - halfX, Math.max(-85, cy - halfY), cx + halfX, Math.min(85, cy + halfY)].map((v) => v.toFixed(5)).join(",");
}

/** A satellite picture of the trail's area (Esri World Imagery), for card photos when the trail has none. */
export function trailSatellite(t: { bounds?: [number, number, number, number]; latitude: number; longitude: number }, width = 640, height = 400) {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?${new URLSearchParams({ bbox: box(t, width, height, 1.35, 0.01), bboxSR: "4326", imageSR: "3857", size: `${width},${height}`, format: "jpg", f: "image" })}`;
}

export function trailThumbnail(t: { bounds?: [number, number, number, number]; latitude: number; longitude: number }, width = 160, height = 120) {
  const [w, s, e, n] = t.bounds ?? [t.longitude - 0.012, t.latitude - 0.009, t.longitude + 0.012, t.latitude + 0.009];
  const cx = (w + e) / 2, cy = (s + n) / 2;
  const cos = Math.max(0.2, Math.cos((cy * Math.PI) / 180));
  // Fit the extent in the picture's shape with a margin; never closer than about 1 km across.
  const halfX = Math.min(20, Math.max(0.006, (e - w) / 2, ((n - s) / 2 / cos) * (width / height)) * 1.2);
  const halfY = (halfX * cos * height) / width;
  const box = [cx - halfX, Math.max(-85, cy - halfY), cx + halfX, Math.min(85, cy + halfY)].map((v) => v.toFixed(5)).join(",");
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/export?${new URLSearchParams({ bbox: box, bboxSR: "4326", imageSR: "3857", size: `${width * 2},${height * 2}`, format: "jpg", f: "image" })}`;
}
