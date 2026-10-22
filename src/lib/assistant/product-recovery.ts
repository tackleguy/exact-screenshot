import { fetchSource, parseProduct, searchProductSources, sourceUrl } from "./research";
import { isProductCollection, matchesProductIdentity, productNameFromUrl, productPageUrl, sameProductListing } from "./product-input";
import { storefrontProductUrl, parseStorefrontProduct, combineSameProduct } from "./product-storefront";
import { findCatalogProduct, lookupProductCatalog } from "./product-catalog";
import { productReading } from "./product-ai";
import { productFromExcerpt } from "./product-excerpt";
import type { ProductResearch, WebSource } from "./types";

type Dependencies = {
  catalog?: typeof lookupProductCatalog;
  fetch: typeof fetchSource;
  search: (query: string, requestedUrl: string) => Promise<WebSource[]>;
};
const allFacts = (p: ProductResearch) => [...p.facts, ...p.variants.flatMap(v => v.facts)];
const measured = (p: ProductResearch) => allFacts(p).some(f => f.kind === "weight");
const productBrand = (p: ProductResearch) => {
  const brands = [...new Set(allFacts(p).filter(f => f.kind === "brand").map(f => f.value))];
  return brands.length === 1 ? brands[0] : "";
};
const comparisonPage = (s: WebSource) => /\b(?:reviews?|comparison|versus|vs)\b/i.test(s.title) || /\/(?:reviews?|gearreviews)(?:\/|$)/i.test(new URL(s.url).pathname);
const cleanTitle = (title: string) => title.replace(/\s+[|–—]\s+.*$/, "").trim().slice(0, 180);
const usableTitle = (title: string) => !/^(?:www\.)?[^ ]+\.[a-z]{2,}$|access denied|just a moment|verify (?:you|your)|robot check|captcha|page not found|403 forbidden/i.test(title);
const uniqueSources = (sources: WebSource[]) => sources.filter((s, i, all) => {
  try { sourceUrl(s.url); return all.findIndex(other => sameProductListing(other.url, s.url)) === i; } catch { return false; }
}).slice(0, 24);

/** Read public page data on alternate sites as thoroughly as the original link. */
async function readProduct(url: string, deps: Dependencies): Promise<ProductResearch> {
  const page = await deps.fetch(url);
  if (isProductCollection(page.url)) throw new Error("This is a collection, not a product.");
  let product = parseProduct(page.body, page.url);
  const feed = !measured(product) ? storefrontProductUrl(page.body, page.url) : null;
  if (feed) {
    try {
      const data = await deps.fetch(feed);
      if (new URL(data.url).origin === new URL(page.url).origin) product = combineSameProduct(product, parseStorefrontProduct(data.body, page.url, product));
    } catch { /* Preserve readable page facts if the public feed is unavailable. */ }
  }
  const reading = productReading(page.body, product.title, page.url);
  return { ...product, readings: reading ? [reading] : [] };
}

export async function researchProduct(url: string, name = "", dependencies?: Dependencies): Promise<ProductResearch> {
  sourceUrl(url); // Reject unsafe inputs before searching or fetching alternatives.
  // Stay inside the form's 55-second limit; abort active HTTP requests as well.
  const deadline = AbortSignal.timeout(48_000);
  const deps: Dependencies = dependencies ?? {
    catalog: lookupProductCatalog,
    fetch: target => fetchSource(target, 0, 8_000_000, true, AbortSignal.any([deadline, AbortSignal.timeout(8_000)])),
    search: (query, requestedUrl) => searchProductSources(query, requestedUrl, deadline),
  };
  const catalog = deps.catalog?.(productPageUrl(url));
  if (catalog) return { ...catalog, recovery: { ...catalog.recovery!, requestedUrl: url } };
  let original: ProductResearch | undefined;
  try {
    if (!isProductCollection(url)) original = await readProduct(productPageUrl(url), deps);
    if (original && measured(original)) return original;
  } catch { /* Search for the exact product when its original page is unreadable. */ }
  let identity = name.trim().slice(0, 180) || (original?.title && usableTitle(original.title) ? cleanTitle(original.title) : "") || productNameFromUrl(url);
  // Structured model names can remove retailer marketing text without dropping
  // important model numbers. Never infer an identifier from a recommendation.
  const field = (kind: "brand" | "model" | "sku") => original?.facts.find(f => f.kind === kind)?.value.trim() ?? "";
  const modelIdentity = field("brand") && field("model") ? `${field("brand")} ${field("model")}` : "";
  const identifierQuery = field("brand") && field("sku") ? `${field("brand")} ${field("sku")}` : "";
  const queries = [...new Set([identity || url, modelIdentity || identifierQuery].filter(Boolean))].slice(0, 2);
  const searches = await Promise.allSettled(queries.map(query => deps.search(query, url)));
  let sources = uniqueSources(searches.flatMap(r => r.status === "fulfilled" ? r.value : []));
  // Numeric retailer URLs cannot name the product. The exact indexed listing
  // can establish its name, then a second query discovers other sellers.
  const exact = sources.find(s => sameProductListing(url, s.url));
  if (!identity && exact && usableTitle(exact.title)) {
    identity = cleanTitle(exact.title);
    try { sources = uniqueSources([...sources, ...await deps.search(identity, url)]); } catch { /* Keep the indexed listing. */ }
  }
  const recovery = (method: NonNullable<ProductResearch["recovery"]>["method"], notice: string) => ({ method, notice, requestedUrl: url, sources });
  function supplement(product: ProductResearch) {
    if (!original || original.variants.length || product.variants.length) return product;
    const extra = product.facts.filter(f => !original!.facts.some(known => known.kind === f.kind));
    return { ...original, readings: [...(original.readings ?? []), ...(product.readings ?? [])].slice(0, 2), facts: [...original.facts, ...extra.map(f => ({ ...f, sourceUrl: product.url, evidence: `${f.evidence} · ${product.url}` }))] };
  }
  const excerpt = exact ? productFromExcerpt(exact) : undefined;
  if (excerpt && measured(excerpt)) return { ...supplement(excerpt), recovery: recovery("search-excerpt", "Missing product details were found in its public search excerpt and are unverified. Confirm your exact model and values before filling the form.") };
  const matches = (title: string) => [identity, modelIdentity].some(query => query && matchesProductIdentity(query, title));
  const identifierMatch = (product: ProductResearch) => Boolean(identifierQuery && ["brand", "sku"].every(kind => product.facts.some(f => f.kind === kind && f.value.toLowerCase() === field(kind as "brand" | "sku").toLowerCase())));
  const candidates = sources.filter(s => !sameProductListing(url, s.url) && !isProductCollection(s.url) && !comparisonPage(s) && (matches(s.title) || matches(`${s.title} ${s.snippet}`) || (identifierQuery && matchesProductIdentity(identifierQuery, `${s.title} ${s.snippet}`)))).slice(0, 6);
  const pages = await Promise.allSettled(candidates.map(async s => {
    const product = await readProduct(s.url, deps);
    if (comparisonPage({ title: product.title, url: product.url, snippet: "" })) return null;
    return (matches(product.title) || matches(`${productBrand(product)} ${product.title}`) || identifierMatch(product)) ? product : null;
  }));
  const products = pages.flatMap(r => r.status === "fulfilled" && r.value ? [r.value] : []);
  // Prefer a readable page with the most available specifications, keeping its
  // variants together rather than combining measurements across different sizes.
  const richness = (p: ProductResearch) => new Set([...p.facts, ...p.variants.flatMap(v => v.facts)].map(f => f.kind)).size;
  const alternate = products.filter(measured).sort((a, b) => richness(b) - richness(a))[0];
  if (alternate) return { ...supplement(alternate), recovery: recovery("alternate-page", `Found specifications on ${new URL(alternate.url).hostname}. Details already found on your original page are kept when they describe a single item. Confirm the model, size and included parts before filling the form.`) };
  // If readable pages are blocked too, exact-name indexed excerpts still offer
  // reviewable evidence. Never turn those snippets into verified measurements.
  const alternateExcerpt = candidates.filter(s => matches(s.title)).map(productFromExcerpt).find(measured);
  if (alternateExcerpt) return { ...supplement(alternateExcerpt), recovery: recovery("search-excerpt", "Found specifications in another listing’s search excerpt. These values are unverified; confirm the exact model, size and measurements before filling the form.") };
  const partial = original ?? products.sort((a, b) => richness(b) - richness(a))[0] ?? excerpt;
  const readings = [...(original?.readings ?? []), ...products.flatMap(p => p.readings ?? [])].filter((r, i, all) => all.findIndex(other => other.url === r.url) === i).slice(0, 2);
  return { ...(partial ?? { title: identity || "Find your product", url, retrievedAt: new Date().toISOString(), facts: [], variants: [], excerpt: "" }), readings, recovery: recovery("not-found", readings.length ? "The pages are readable, but standard extraction missed some specifications. Use Eco AI to read the page text and find supported details." : partial?.facts.length || partial?.variants.some(v => v.facts.length) ? "Found some details, but the item’s weight is still missing. Review the available fields, choose another source below, or paste the missing specifications." : sources.length ? "Found possible matches, but no usable specifications yet. Choose your exact product below, or paste its specifications to extract them." : identity ? "No usable public specifications found yet. Paste the specifications from your product page below to extract them." : "This link does not identify the product. Enter the brand and model in Item name and try again, or paste its specifications below.") };
}


export async function researchProductName(query: string, dependencies?: Dependencies): Promise<{ product?: ProductResearch; sources: WebSource[] }> {
  const cached = dependencies ? undefined : findCatalogProduct(query);
  if (cached) return { product: cached, sources: cached.recovery?.sources ?? [] };
  const deadline = AbortSignal.timeout(48_000);
  const deps: Dependencies = dependencies ?? {
    fetch: target => fetchSource(target, 0, 8_000_000, true, AbortSignal.any([deadline, AbortSignal.timeout(8_000)])),
    search: (name, requestedUrl) => searchProductSources(name, requestedUrl || undefined, deadline),
  };
  const sources = uniqueSources(await deps.search(query, "")).filter(s => !isProductCollection(s.url));
  // Broad category requests remain a choice. Named-model searches are read
  // automatically, with the matched product shown in the form before saving.
  if (query.trim().split(/\s+/).length < 3) return { sources };
  const candidates = sources.filter(s => !comparisonPage(s) && matchesProductIdentity(query, `${s.title} ${s.snippet}`)).slice(0, 3);
  const pages = await Promise.allSettled(candidates.map(async source => {
    const product = await readProduct(source.url, deps);
    if (comparisonPage({ ...source, title: product.title, url: product.url }) || !matchesProductIdentity(query, `${productBrand(product)} ${product.title}`)) return;
    return product;
  }));
  const products = pages.flatMap(p => p.status === "fulfilled" && p.value ? [p.value] : []);
  const product = products.find(measured) ?? products.find(p => p.readings?.length);
  if (!product) return { sources };
  return { sources, product: { ...product, recovery: { method: measured(product) ? "alternate-page" : "not-found", requestedUrl: product.url, sources, notice: measured(product) ? "Read the matching product page. Confirm the model and size in your gear form before saving." : "Found the product page. Eco AI can read its text for missing details." } } };
}
