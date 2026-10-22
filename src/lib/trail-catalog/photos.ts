import type { CatalogTrail } from "./types";
export interface CatalogPhoto {
  id: string;
  url: string;
  title: string;
  artist: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  distanceMeters: number;
}
export interface CommonsPage {
  pageid: number;
  title: string;
  imageinfo?: { url: string; thumburl?: string; mime?: string; extmetadata?: Record<string, { value?: string }> }[];
}
export function plainPhotoText(value = "") {
  return value.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim().slice(0, 500);
}
function allowedUrl(value: string | undefined, hosts: string[]) {
  try { const url = new URL(value ?? ""); return url.protocol === "https:" && hosts.includes(url.hostname) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
/** Only return attributed raster photos with an explicit reusable license. */
export function parseCommonsPhoto(page: CommonsPage, distanceMeters: number): CatalogPhoto | null {
  const info = page.imageinfo?.[0], meta = info?.extmetadata ?? {};
  const license = plainPhotoText(meta.LicenseShortName?.value);
  const licenseUrl = allowedUrl(meta.LicenseUrl?.value, ["creativecommons.org", "www.creativecommons.org"]);
  const url = allowedUrl(info?.thumburl ?? info?.url, ["upload.wikimedia.org", "thumb.wikimedia.org"]);
  if (!url || !info?.mime || !["image/jpeg", "image/png", "image/webp"].includes(info.mime) || !/^(CC BY(?:-SA)? [\d.]+|CC0(?: [\d.]+)?|Public domain)$/i.test(license)) return null;
  if (!licenseUrl && !/^(CC0|Public domain)/i.test(license)) return null;
  const artist = plainPhotoText(meta.Artist?.value);
  if (!artist || !Number.isFinite(distanceMeters) || distanceMeters < 0) return null;
  return {
    id: String(page.pageid), url,
    title: plainPhotoText(page.title.replace(/^File:/, "").replace(/_/g, " ").replace(/\.(jpg|jpeg|png|webp)$/i, "")),
    artist, license, licenseUrl: licenseUrl ?? (/^CC0/i.test(license) ? "https://creativecommons.org/publicdomain/zero/1.0/" : "https://creativecommons.org/publicdomain/mark/1.0/"),
    sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`, distanceMeters,
  };
}

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
async function commons(params: Record<string, string>) {
  // origin=* lets the browser call Commons directly (the static app has no server); the server sends a User-Agent.
  const browser = typeof window !== "undefined";
  const response = await fetch(`${COMMONS_API}?${new URLSearchParams({ action: "query", format: "json", ...(browser ? { origin: "*" } : {}), ...params })}`, {
    ...(browser ? {} : { headers: { "User-Agent": "Hyked/1.0 (https://github.com/tackleguy/health)" }, next: { revalidate: 86400 } }),
    signal: AbortSignal.timeout(8000),
  } as RequestInit);
  if (!response.ok) throw new Error("Photo source unavailable");
  const data = await response.json();
  if (data.error) throw new Error("Photo query failed");
  return data;
}

export async function nearbyCatalogPhotos(latitude: number, longitude: number): Promise<CatalogPhoto[]> {
  const geo = await commons({ list: "geosearch", gscoord: `${latitude}|${longitude}`, gsradius: "1500", gsnamespace: "6", gslimit: "12" });
  const nearby = (geo.query?.geosearch ?? []) as { pageid: number; dist: number }[];
  if (!nearby.length) return [];
  const images = await commons({ pageids: nearby.map(page => page.pageid).join("|"), prop: "imageinfo", iiprop: "url|mime|extmetadata", iiurlwidth: "720" });
  const pages = (images.query?.pages ?? {}) as Record<string, CommonsPage>;
  return nearby.map(point => pages[String(point.pageid)] ? parseCommonsPhoto(pages[String(point.pageid)], point.dist) : null).filter((photo): photo is CatalogPhoto => photo !== null).slice(0, 6);
}

/** The trail's own photo: the main Commons image of its matched Wikidata item, with licence and author. */
export function wikiPhotos(trail: Pick<CatalogTrail, "name" | "wiki">): CatalogPhoto[] {
  const image = trail.wiki?.image;
  if (!image) return [];
  return [{
    id: image.pageUrl,
    url: image.url,
    title: trail.wiki?.title ?? trail.name,
    artist: image.artist ?? "Unknown author",
    license: image.license ?? "See file page",
    licenseUrl: image.licenseUrl ?? image.pageUrl,
    sourceUrl: image.pageUrl,
    distanceMeters: 0,
  }];
}
