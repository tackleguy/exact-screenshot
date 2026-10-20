import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isProductCollection, matchesProductSearch, sameProductListing } from "./product-input";
import { completeHtmlPrefix, decodeText, htmlText } from "./product-text";
export { decodeText, htmlText, weightToOz } from "./product-text";
export { parseProduct } from "./product-parser";
import type { WebSource } from "./types";

export function publicIPv4(address: string) {
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || b === 2)) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0));
}
export function sourceUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || isIP(url.hostname) || url.hostname.includes(":") || !url.hostname.includes(".") || /\.(local|internal|localhost)$/i.test(url.hostname)) throw new Error("Use a public HTTPS product page.");
  return url;
}
// Pin DNS to a validated public IPv4 address, including every redirect.
export async function fetchSource(raw: string, redirects = 0, maxBytes = 2_000_000, allowPartial = false, signal?: AbortSignal): Promise<{ url: string; body: string }> {
  signal?.throwIfAborted();
  const url = sourceUrl(raw);
  if (redirects > 3) throw new Error("The source redirected too many times.");
  const addresses = await lookup(url.hostname, { family: 4, all: true });
  if (!addresses.length || addresses.some(a => !publicIPv4(a.address))) throw new Error("This source address is unavailable.");
  signal?.throwIfAborted();
  const response = await new Promise<{ status: number; location?: string; body: string }>((resolve, reject) => {
    const request = https.get(url, { signal, family: 4, lookup: (_hostname, _options, callback) => callback(null, addresses[0].address, 4), headers: { "User-Agent": "Hyked/1.0 (product-specification-research)", Accept: "text/html,application/xml,text/xml,application/rss+xml", "Accept-Encoding": "identity" } }, res => {
      const status = res.statusCode ?? 500;
      if (status >= 300 && status < 400) { res.resume(); resolve({ status, location: res.headers.location, body: "" }); return; }
      if (status !== 200) { res.resume(); reject(new Error(`Source returned ${status}. Try another official page.`)); return; }
      if (!/text\/|xml|json/.test(res.headers["content-type"] ?? "")) { res.resume(); reject(new Error("Use an HTML product page; this source is not readable text.")); return; }
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", chunk => { size += chunk.length; if (size > maxBytes) {
        if (!allowPartial) { request.destroy(new Error("Source page is too large.")); return; }
        chunks.push(chunk.subarray(0, Math.max(0, maxBytes - (size - chunk.length))));
        const prefix = Buffer.concat(chunks).toString("utf8");
        // Only complete markup can contribute facts; an unfinished script or
        // trailing text measurement is discarded when capping a large page.
        const complete = completeHtmlPrefix(prefix);
        resolve({ status, body: complete }); res.destroy(); return;
      } chunks.push(chunk); });
      res.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    const timeout = setTimeout(() => request.destroy(new Error("Source timed out. Try another page.")), 12_000);
    request.on("close", () => clearTimeout(timeout));
    request.on("error", reject);
  });
  if (response.status >= 300 && response.status < 400 && response.location) return fetchSource(new URL(response.location, url).href, redirects + 1, maxBytes, allowPartial, signal);
  if (response.status !== 200) throw new Error("The source did not provide a readable page.");
  return { url: url.href, body: response.body };
}
export function parseSearch(xml: string): WebSource[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(match => {
    const field = (name: string) => decodeText(match[1].match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? "").replace(/<[^>]*>/g, "").trim();
    try { const url = sourceUrl(field("link")); return [{ title: field("title").slice(0, 200), url: url.href, snippet: field("description").slice(0, 350) }]; } catch { return []; }
  }).slice(0, 6);
}
export function parsePublicSearch(html: string): WebSource[] {
  const results: WebSource[] = [];
  const links = [...html.matchAll(/<a\b([^>]*\bclass=["'][^"']*\bresult__a\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi)];
  for (let i = 0; i < Math.min(links.length, 10); i++) {
    const match = links[i];
    try {
      const href = decodeText(match[1].match(/\bhref=["']([^"']+)["']/i)?.[1] ?? "");
      const target = new URL(href, "https://duckduckgo.com");
      const url = sourceUrl(target.hostname === "duckduckgo.com" ? target.searchParams.get("uddg") ?? "" : target.href).href;
      const section = html.slice(match.index! + match[0].length, links[i + 1]?.index);
      const snippet = section.match(/<(?:a|div)\b[^>]*class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i)?.[1] ?? "";
      results.push({ title: htmlText(match[2]).slice(0, 240), url, snippet: htmlText(snippet).slice(0, 600) });
    } catch { /* Ignore ads, search navigation and non-public links. */ }
  }
  return results;
}
export async function searchProductWeb(query: string, requestedUrl?: string, signal?: AbortSignal): Promise<WebSource[]> {
  const timeout = signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
  const searches = [
    // Fixed public search endpoint: use the standard HTTP client, with no
    // browser impersonation, cookies, challenge solving or proxy service.
    fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + " weight")}`, { signal: timeout, cache: "no-store", redirect: "error" }).then(async r => {
      if (r.status !== 200) throw new Error("Public search is unavailable.");
      const html = await r.text();
      return html.length <= 2_000_000 ? parsePublicSearch(html) : [];
    }),
    fetchSource(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(query + " product specifications weight")}`, 0, 2_000_000, false, timeout).then(r => parseSearch(r.body)),
  ];
  if (process.env.BRAVE_SEARCH_API_KEY) searches.push(
    fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query + " product specifications weight")}&count=10`, { headers: { "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY, Accept: "application/json" }, signal: timeout, cache: "no-store", redirect: "error" }).then(async response => {
      if (!response.ok) throw new Error("Online search is unavailable.");
      const data = await response.json();
      return (data.web?.results ?? []).slice(0, 10).flatMap((r: { title?: string; url?: string; description?: string }) => {
        try { return [{ title: htmlText(r.title ?? "").slice(0, 240), url: sourceUrl(r.url ?? "").href, snippet: htmlText(r.description ?? "").slice(0, 600) }]; } catch { return []; }
      });
    }),
  );
  const results = await Promise.allSettled(searches);
  if (results.every(r => r.status === "rejected")) throw new Error("Online search is unavailable.");
  const sources = results.flatMap(r => r.status === "fulfilled" ? r.value : []);
  return sources.filter(s => !isProductCollection(s.url) && ((requestedUrl && sameProductListing(requestedUrl, s.url)) || matchesProductSearch(query, s)))
    .filter((s, i, all) => all.findIndex(other => sameProductListing(other.url, s.url)) === i).slice(0, 12);
}
export async function searchSources(query: string, kind: "trail" | "product"): Promise<WebSource[]> {
  if (kind === "trail") return (await import("./trail-research")).searchTrailSources(query);
  return searchProductSources(query);
}
export async function searchProductCatalog(query: string, signal?: AbortSignal): Promise<WebSource[]> {
  // Public manufacturer catalogs work without a search key or model download.
  const catalogs = [
    { match: /\b(msr|hubba|therm.?a.?rest|platypus|seal.?line|packtowl|cascade designs)\b/i, strip: /\b(msr|therm.?a.?rest|platypus|seal.?line|packtowl|cascade designs)\b/gi, origin: "https://cascadedesigns.com" },
    { match: /\b(nemo|tensor)\b/i, strip: /\bnemo(?: equipment)?\b/gi, origin: "https://www.nemoequipment.com" },
    { match: /\b(big agnes|copper spur)\b/i, strip: /\bbig agnes\b/gi, origin: "https://www.bigagnes.com" },
    { match: /\bsea\s*to\s*summit\b/i, strip: /\bsea\s*to\s*summit\b/gi, origin: "https://seatosummit.com" },
  ];
  const catalog = catalogs.find(c => c.match.test(query));
  if (catalog) {
    const terms = query.replace(catalog.strip, "").trim() || query;
    try {
      const result = await fetchSource(`${catalog.origin}/search/suggest.json?q=${encodeURIComponent(terms)}&resources%5Btype%5D=product&resources%5Blimit%5D=5`, 0, 2_000_000, false, signal);
      const data = JSON.parse(result.body);
      const products = (data.resources?.results?.products ?? []).slice(0, 5).flatMap((p: { title?: string; url?: string; body?: string; vendor?: string }) => {
        try {
          if (!p.url || !p.title) return [];
          const url = sourceUrl(new URL(p.url, catalog.origin).href);
          for (const key of ["_pos", "_sid", "_ss", "_psq", "_psid"]) url.searchParams.delete(key);
          return [{ title: htmlText(p.title).slice(0, 200), url: url.href, snippet: `${htmlText(p.vendor ?? "")} · Manufacturer catalog. ${htmlText(p.body ?? "").slice(0, 200)}` }];
        } catch { return []; }
      });
      if (products.length) return products;
    } catch { /* Fall back to public search when a manufacturer's catalog is unavailable. */ }
  }
  return [];
}
/** Catalog failure or an unavailable search provider must not suppress other sources. */
export async function searchProductSources(query: string, requestedUrl?: string, signal?: AbortSignal): Promise<WebSource[]> {
  const timeout = signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
  const results = await Promise.allSettled([searchProductCatalog(query, timeout), searchProductWeb(query, requestedUrl, timeout)]);
  return results.flatMap(r => r.status === "fulfilled" ? r.value : [])
    .filter(s => !isProductCollection(s.url) && ((requestedUrl && sameProductListing(requestedUrl, s.url)) || matchesProductSearch(query, s)))
    .filter((s, i, all) => all.findIndex(other => sameProductListing(other.url, s.url)) === i).slice(0, 12);
}
