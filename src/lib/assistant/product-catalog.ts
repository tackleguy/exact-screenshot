import type { ProductFact, ProductResearch } from "./types";

// A small, explicitly sourced public catalog, not model memory. Add records only
// after reading the exact listing; never infer a product from a similar name.
const OZARK_SOURCE = "https://www.walmart.com/ip/5128730697?selectedSellerId=0";
const CHECKED_AT = "2026-09-24T03:47:00.000Z";
export function lookupProductCatalog(raw: string): ProductResearch | undefined {
  const url = new URL(raw);
  const id = url.pathname.match(/^\/ip\/(?:[^/]+\/)?(\d+)\/?$/)?.[1];
  if (url.protocol !== "https:" || !/^(?:www\.)?walmart\.com$/i.test(url.hostname) || id !== "5128730697") return;
  // A different seller, offer or variant may represent a bundle or different item.
  for (const key of url.searchParams.keys()) {
    if (key === "selectedSellerId" ? url.searchParams.get(key) !== "0" : true) return;
  }
  const fields: Array<[ProductFact["kind"], string, string]> = [
    ["brand", "Brand", "Ozark Trail"], ["model", "Model", "W2201"], ["sku", "SKU", "W2201"],
    ["weight", "Carry weight", "4.4 lb"], ["packed-size", "Packed size", "23 in x 5 in x 5 in"],
    ["capacity", "Capacity", "1 Person"], ["materials", "Material", "Polyester, Fiberglass"], ["dimensions", "Height", "36 in"],
  ];
  const facts: ProductFact[] = fields.map(([kind, label, value]) => ({ kind, label, value, weightOz: kind === "weight" ? 70.4 : null, sourceUrl: OZARK_SOURCE, evidence: `Published source checked September 24, 2026 UTC: ${label}: ${value} · ${OZARK_SOURCE}` }));
  facts.push({ kind: "price", label: "Last checked price (September 24, 2026 UTC)", value: "32.64 USD", amount: 32.64, currency: "USD", weightOz: null, sourceUrl: OZARK_SOURCE, evidence: `Published offer checked September 24, 2026 UTC: 32.64 USD. This is a dated observation, not a live price. ${OZARK_SOURCE}` });
  return { title: "Ozark Trail 1-Person Backpacking Tent", url: OZARK_SOURCE, retrievedAt: CHECKED_AT, facts, variants: [], excerpt: facts.map(f => `${f.label}: ${f.value}`).join("\n"), recovery: { method: "catalog", requestedUrl: raw, notice: "Found this exact item in Hyked’s verified public catalog. Specifications were checked September 24, 2026 UTC. The price is a dated observation and may have changed. Review the details, then fill out parameters.", sources: [{ title: "Walmart · Ozark Trail W2201", url: OZARK_SOURCE, snippet: "Published specifications for Walmart item 5128730697, checked September 24, 2026." }] } };
}

/** A catalog alias must identify the model, not just its brand or category. */
export function findCatalogProduct(name: string): ProductResearch | undefined {
  const normalized = name.toLowerCase().replace(/[™®]/g, "").replace(/\bsolo\b|\bone person\b/g, "1 person").replace(/[^a-z0-9]+/g, " ").trim();
  const aliases = ["ozark trail 1 person tent", "ozark trail 1 person hiker tent", "ozark trail 1 person backpacking tent", "ozark trail w2201", "w2201"];
  return aliases.includes(normalized) ? lookupProductCatalog(OZARK_SOURCE) : undefined;
}
