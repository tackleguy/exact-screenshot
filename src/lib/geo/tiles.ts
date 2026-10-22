import { VectorTile, type VectorTileFeature } from "@mapbox/vector-tile";
import Protobuf from "pbf";
/** Readers for public map tiles (OpenStreetMap US vector tiles, AWS Terrarium elevation), on the server or in the browser. */

export type LngLat = [number, number];

export function tileOf([lng, lat]: LngLat, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
}

/** Small LRU so repeated lookups (several towns, several trails nearby) reuse downloaded tiles. */
class Lru<V> {
  private map = new Map<string, V>();
  constructor(private max: number) {}
  delete(key: string) { this.map.delete(key); }
  get(key: string) {
    const value = this.map.get(key);
    if (value !== undefined) { this.map.delete(key); this.map.set(key, value); }
    return value;
  }
  set(key: string, value: V) {
    this.map.set(key, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }
}

const env = (name: string) => (typeof process !== "undefined" ? process.env?.[name] : undefined);
const VECTOR_BASE = env("VECTOR_TILE_URL") || "https://tiles.openstreetmap.us/vector";
const TERRARIUM_BASE = env("TERRARIUM_TILE_URL") || "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const inBrowser = typeof window !== "undefined" && typeof createImageBitmap === "function";
const vectorCache = new Lru<Promise<VectorTile | null>>(600);
const demCache = new Lru<Promise<Float32Array | null>>(400);

async function fetchBytes(url: string) {
  const response = await fetch(url, { ...(inBrowser ? {} : { headers: { "User-Agent": "Hyked/1.0 (https://github.com/tackleguy/health)" }, cache: "no-store" as const }), signal: AbortSignal.timeout(15_000) });
  if (response.status === 204 || response.status === 404) return null;
  if (!response.ok) throw new Error(`Tile ${response.status}: ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** A decoded OpenStreetMap US vector tile ("openmaptiles" basemap or "trails"). Empty tiles are null. */
export function vectorTile(set: "openmaptiles" | "trails", z: number, x: number, y: number) {
  const key = `${set}/${z}/${x}/${y}`;
  let tile = vectorCache.get(key);
  if (!tile) {
    tile = fetchBytes(`${VECTOR_BASE}/${key}.mvt`).then((bytes) => (bytes && bytes.length ? new VectorTile(new Protobuf(bytes) as unknown as ConstructorParameters<typeof VectorTile>[0]) : null));
    tile.catch(() => vectorCache.delete(key));
    vectorCache.set(key, tile);
  }
  return tile;
}

export interface TileFeature {
  layer: string;
  properties: Record<string, string | number | boolean>;
  geometry: GeoJSON.Geometry;
}

/** Every feature in the given layers of a tile, as lon/lat GeoJSON; null when the tile could not be read. */
export async function tileFeaturesOrNull(set: "openmaptiles" | "trails", z: number, x: number, y: number, layers: string[]): Promise<TileFeature[] | null> {
  let tile: VectorTile | null;
  try { tile = await vectorTile(set, z, x, y); } catch { return null; }
  if (!tile) return [];
  const out: TileFeature[] = [];
  for (const name of layers) {
    const layer = tile.layers[name];
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const feature: VectorTileFeature = layer.feature(i);
      const geo = feature.toGeoJSON(x, y, z);
      out.push({ layer: name, properties: feature.properties as TileFeature["properties"], geometry: geo.geometry });
    }
  }
  return out;
}

/** Like tileFeaturesOrNull, with unreadable tiles treated as empty. */
export async function tileFeatures(set: "openmaptiles" | "trails", z: number, x: number, y: number, layers: string[]): Promise<TileFeature[]> {
  return (await tileFeaturesOrNull(set, z, x, y, layers)) ?? [];
}

/** RGBA pixels of a PNG: canvas in the browser, pngjs on the server (loaded only there). */
async function decodePng(bytes: Uint8Array): Promise<{ data: Uint8Array | Uint8ClampedArray; width: number; height: number }> {
  if (inBrowser) {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    return { data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data, width: bitmap.width, height: bitmap.height };
  }
  const name = "pngjs";
  const { PNG } = (await import(/* @vite-ignore */ name)) as typeof import("pngjs");
  const png = PNG.sync.read(Buffer.from(bytes));
  return { data: png.data, width: png.width, height: png.height };
}

/** Terrarium elevation (meters) for a 256×256 tile, row-major. */
function demTile(z: number, x: number, y: number) {
  const key = `${z}/${x}/${y}`;
  let tile = demCache.get(key);
  if (!tile) {
    tile = fetchBytes(`${TERRARIUM_BASE}/${key}.png`).then(async (bytes) => {
      if (!bytes) return null;
      const { data, width, height } = await decodePng(bytes);
      const out = new Float32Array(width * height);
      for (let i = 0; i < out.length; i++) {
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        out[i] = r * 256 + g + b / 256 - 32768;
      }
      return out;
    });
    tile.catch(() => demCache.delete(key));
    demCache.set(key, tile);
  }
  return tile;
}

/** Runs tasks with at most `limit` in flight. */
async function pooled<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await run(items[next++]);
  }));
}

/** Ground elevations in meters (NaN where unavailable), bilinear within each tile. */
export async function elevations(points: LngLat[], z = 13): Promise<number[]> {
  const n = 2 ** z;
  const located = points.map(([lng, lat]) => {
    const fx = ((lng + 180) / 360) * n;
    const rad = (lat * Math.PI) / 180;
    const fy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
    return { fx, fy, x: Math.floor(fx), y: Math.floor(fy) };
  });
  // Each tile is downloaded once, a few at a time, with one retry.
  const tiles = new Map<string, Float32Array | null>();
  for (const p of located) tiles.set(`${p.x}/${p.y}`, null);
  await pooled([...tiles.keys()], 6, async (key) => {
    const [x, y] = key.split("/").map(Number);
    for (let attempt = 0; attempt < 2; attempt++) {
      const data = await demTile(z, x, y).catch(() => null);
      if (data) { tiles.set(key, data); return; }
    }
  });
  return located.map(({ fx, fy, x, y }) => {
    const data = tiles.get(`${x}/${y}`);
    if (!data) return NaN;
    const px = Math.min(254.999, Math.max(0, (fx - x) * 256 - 0.5)), py = Math.min(254.999, Math.max(0, (fy - y) * 256 - 0.5));
    const x0 = Math.floor(px), y0 = Math.floor(py), dx = px - x0, dy = py - y0;
    const at = (cx: number, cy: number) => data[cy * 256 + cx];
    return (at(x0, y0) * (1 - dx) + at(x0 + 1, y0) * dx) * (1 - dy) + (at(x0, y0 + 1) * (1 - dx) + at(x0 + 1, y0 + 1) * dx) * dy;
  });
}
