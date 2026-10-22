import type { ProductDraft, ProductFact, ProductFactKind, ProductResearch } from "./types";
export const PRODUCT_FIELDS: { kind: ProductFactKind; label: string }[] = [
  { kind: "weight", label: "Weight per item" }, { kind: "price", label: "Price per item" },
  { kind: "packed-size", label: "Packed size" }, { kind: "brand", label: "Brand" },
  { kind: "model", label: "Model" }, { kind: "sku", label: "SKU" },
  { kind: "capacity", label: "Capacity" }, { kind: "dimensions", label: "Dimensions" },
  { kind: "materials", label: "Materials" },
];
export function defaultSelections(facts: ProductFact[]): Partial<Record<ProductFactKind, string>> {
  return Object.fromEntries(PRODUCT_FIELDS.map(({ kind }) => {
    const eligible = facts.map((f, i) => ({ ...f, i })).filter(f => f.kind === kind);
    if (eligible.some(f => f.requiresChoice)) return [kind, ""];
    const distinct = eligible.filter((f, i) => eligible.findIndex(g => (kind === "weight" ? g.weightOz === f.weightOz : g.value === f.value)) === i);
    const packed = distinct.filter(f => /^(?:packaged|packed|total) weight/i.test(f.label));
    const choice = kind === "weight" && packed.length === 1 ? packed[0] : distinct.length === 1 ? distinct[0] : undefined;
    return [kind, choice ? String(choice.i) : ["materials", "dimensions"].includes(kind) && distinct.length ? "all" : ""];
  }));
}
export function makeProductDraft(product: ProductResearch, variantIndex: string, selections: Partial<Record<ProductFactKind, string>>): ProductDraft | null {
  const variant = product.variants.length ? product.variants[Number(variantIndex)] : undefined;
  if (product.variants.length && (!variantIndex || !variant)) return null;
  const facts = variant?.facts ?? product.facts;
  const draft: ProductDraft = { name: variant?.name ?? product.title, sourceUrl: variant?.url ?? product.url, sourceCheckedAt: product.retrievedAt };
  const supplementSources = new Set<string>();
  for (const { kind } of PRODUCT_FIELDS) {
    const index = selections[kind];
    if (index === undefined || index === "") continue;
    const f = facts[Number(index)];
    const selectedFacts = index === "all" && ["materials", "dimensions"].includes(kind) ? facts.filter(f => f.kind === kind) : f?.kind === kind ? [f] : [];
    for (const selected of selectedFacts) if (selected.sourceUrl) supplementSources.add(selected.sourceUrl);
    if (index === "all" && (kind === "materials" || kind === "dimensions")) draft[kind] = facts.filter(f => f.kind === kind).map(f => `${f.label}: ${f.value}`).join("; ").slice(0, 1000);
    else if (f?.kind === kind) {
      if (kind === "weight" && f.weightOz !== null) draft.weightOz = f.weightOz;
      else if (kind === "price" && f.amount !== undefined && f.currency) { draft.price = f.amount; draft.priceCurrency = f.currency; }
      else if (kind === "packed-size") draft.packedSize = f.value;
      else if (kind !== "weight" && kind !== "price") draft[kind] = ["materials", "dimensions"].includes(kind) ? `${f.label}: ${f.value}` : f.value;
    }
  }
  if (Object.keys(draft).length > 3 && product.recovery) draft.sourceNote = product.recovery.method === "alternate-page"
    ? "Specifications recovered from another public page. Check the model, size and included parts."
    : product.recovery.method === "catalog" ? "Published specification snapshot from Hyked’s public catalog. Check the source date and exact item; the recorded price may have changed."
    : product.recovery.method === "local-ai" ? "Eco AI extracted specifications from page quotes. Confirm the exact item and size before relying on them."
    : "Unverified specifications from a search excerpt or pasted text. Verify values against the exact product or a scale.";
  if (draft.sourceNote && supplementSources.size) draft.sourceNote = `${draft.sourceNote} Sources: ${[...supplementSources].join("; ")}`.slice(0, 1000);
  return draft;
}
export function formatProductPrice(price: number, currency: string) {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "code" }).format(price); }
  catch { return `${price.toFixed(2)} ${currency}`; }
}
