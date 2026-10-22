import test from "node:test";
import assert from "node:assert/strict";
import { applyProductAI, productAIInput, productReading } from "./product-ai";
import { defaultSelections, makeProductDraft } from "./product-draft";
import { productPageUrl } from "./product-input";
import { researchProduct } from "./product-recovery";
import type { ProductResearch } from "./types";
const url = "https://example.com/products/tent";
const text = "Our Alpine tent weighs just 4.4 pounds with its stakes. It is made from polyester. Packed, it measures 23 x 5 x 5 in. Listed price: 39.95 USD.";
const product: ProductResearch = { title: "Alpine tent", url, facts: [], variants: [], excerpt: "", retrievedAt: "2026-09-24T00:00:00Z", readings: [{ title: "Alpine tent", url, text }] };
const answer = (fields: unknown[]) => JSON.stringify({ fields });
const weight = { kind: "weight", value: "4.4 pounds", quote: "Our Alpine tent weighs just 4.4 pounds with its stakes.", source: 0 };

test("local extraction fills sourced narrative specifications and records local-AI provenance", () => {
  const p = applyProductAI(answer([weight, { kind: "materials", value: "polyester", quote: "It is made from polyester.", source: 0 }, { kind: "price", value: "39.95 USD", quote: "Listed price: 39.95 USD.", source: 0 }]), product, "");
  const d = makeProductDraft(p, "", defaultSelections(p.facts))!;
  assert.equal(d.weightOz, 70.4); assert.equal(d.price, 39.95); assert.equal(d.priceCurrency, "USD");
  assert.match(d.materials!, /polyester/); assert.match(d.sourceNote!, /Eco AI/); assert.match(d.sourceNote!, /example.com/);
  assert.equal(p.recovery?.method, "local-ai");
});
test("invented facts, altered quotes, wrong source indices and partial numbers cannot fill parameters", () => {
  for (const bad of [{ ...weight, value: "1.1 pounds" }, { ...weight, quote: "This tent weighs 4.4 pounds." }, { ...weight, source: 3 }, { ...weight, value: "4 pounds" }]) {
    assert.throws(() => applyProductAI(answer([bad]), product, ""), /no additional/);
  }
  assert.throws(() => applyProductAI(answer([{ kind: "weight", value: "4 oz", quote: "Weight: 14 oz", source: 0 }]), { ...product, readings: [{ title: "Tent", url, text: "Weight: 14 oz" }] }, ""), /no additional/);
});
test("shipping, fill weights, estimates and unknown currencies remain unsupported", () => {
  for (const quote of ["Shipping weight: 4.4 pounds", "Fill weighs 4.4 pounds", "It weighs approximately 4.4 pounds", "Recommended tent weighs 4.4 pounds"]) {
    assert.throws(() => applyProductAI(answer([{ ...weight, quote }]), { ...product, readings: [{ title: "Tent", url, text: quote }] }, ""), /no additional/);
  }
  assert.throws(() => applyProductAI(answer([{ kind: "price", value: "$39.95", quote: "Price: $39.95", source: 0 }]), { ...product, readings: [{ title: "Tent", url, text: "Price: $39.95" }] }, ""), /no additional/);
});
test("local AI cannot overwrite sourced fields or choose a size silently", () => {
  const p = applyProductAI(answer([weight]), product, "");
  assert.throws(() => applyProductAI(answer([weight]), p, ""), /no additional/);
  const sized = { ...product, variants: [{ id: "1", name: "Small", url, facts: [] }, { id: "2", name: "Large", url, facts: [] }] };
  assert.throws(() => productAIInput(sized, ""), /exact size/);
  const result = applyProductAI(answer([weight]), sized, "1");
  assert.equal(result.variants[0].facts.length, 0);
  assert.equal(result.variants[1].facts[0].requiresChoice, true);
});
test("readable passages exclude scripts and navigation and have bounded model context", () => {
  const p = productReading(`<nav>Weight: 99 lb</nav><main><script>Weight: 999 lb</script><p>${text}</p></main>`, "Tent", url)!;
  assert.match(p.text, /4.4 pounds/); assert.ok(!p.text.includes("99"));
  assert.ok(productReading(`<p>${text.repeat(500)}</p>`, "Tent", url)!.text.length <= 3500);
  assert.throws(() => productAIInput({ ...product, readings: [] }, ""), /readable page text/);
});
test("missing structured specifications carry actual page text into the local-AI fallback", async () => {
  const p = await researchProduct(url, "Alpine tent", { fetch: async target => ({ url: target, body: `<title>Alpine tent</title><main><p>${text}</p></main>` }), search: async () => [] });
  assert.equal(p.recovery?.method, "not-found");
  assert.ok(p.readings?.[0].text.includes("weighs just 4.4 pounds"));
  assert.match(p.recovery!.notice, /Eco AI/);
});
test("Walmart advertising URLs resolve by item ID without dropping seller or variant selection", async () => {
  const raw = "https://www.walmart.com/ip/Ozark-Trail-1-Person-Hiker-Tent/5128730697?wmlspartner=wlpa&selectedSellerId=0&wl0=&gclid=example&variant=blue&utm_source=ads#details";
  const clean = "https://www.walmart.com/ip/5128730697?selectedSellerId=0&variant=blue";
  assert.equal(productPageUrl(raw), clean);
  const calls: string[] = [];
  await researchProduct(raw, "", { search: async () => [], fetch: async target => { calls.push(target); return { url: target, body: '<p>Weight: 4.4 lb</p>' }; } });
  assert.deepEqual(calls, [clean]);
});

test("the verified catalog answers the exact Walmart item before cloud access and labels the observed price", async () => {
  const { lookupProductCatalog } = await import("./product-catalog");
  const raw = "https://www.walmart.com/ip/Ozark-Trail-1-Person-Hiker-Tent/5128730697?selectedSellerId=0&gclid=tracking";
  const p = await researchProduct(raw, "", { catalog: lookupProductCatalog, fetch: async () => { throw new Error("Must use public catalog first"); }, search: async () => { throw new Error("Must not search"); } });
  assert.equal(p.recovery?.method, "catalog");
  assert.equal(p.facts.find(f => f.kind === "weight")?.weightOz, 70.4);
  assert.equal(p.facts.find(f => f.kind === "price")?.amount, 32.64);
  assert.match(p.facts.find(f => f.kind === "price")!.label, /Last checked/);
  assert.equal(p.recovery?.requestedUrl, raw);
  assert.equal(lookupProductCatalog("https://www.walmart.com/ip/999999"), undefined);
  assert.equal(lookupProductCatalog("https://www.walmart.com/ip/5128730697?selectedSellerId=100"), undefined);
  assert.equal(lookupProductCatalog("https://www.walmart.com/ip/5128730697?variant=large"), undefined);
  assert.equal(lookupProductCatalog("https://walmart.com.fake.example/ip/5128730697"), undefined);
});
