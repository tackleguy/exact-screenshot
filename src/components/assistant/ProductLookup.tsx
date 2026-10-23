"use client";
import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { useLocalModel } from "./useLocalModel";
import { createClient } from "@/lib/supabase/client";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = (await createClient()?.auth.getSession()) ?? { data: { session: null } };
  const token = data.session?.access_token;
  return token ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` } : { "Content-Type": "application/json" };
}
import { normalizeProductInput } from "@/lib/assistant/product-input";
import { defaultSelections, makeProductDraft, PRODUCT_FIELDS } from "@/lib/assistant/product-draft";
import { productFromPastedSpecs } from "@/lib/assistant/product-excerpt";
import type { ProductDraft, ProductFactKind, ProductResearch, WebSource } from "@/lib/assistant/types";

export interface ProductLookupHandle { fill: (input: string) => void }
type RetryTask = { kind: "lookup"; value: string; isPage: boolean; sourceName: string; autoFill: boolean }
  | { kind: "reading"; autoFill: boolean };
export function ProductLookup({ onUse, ref, onBusyChange, productName = "" }: { onUse: (draft: ProductDraft) => void; ref?: Ref<ProductLookupHandle>; onBusyChange?: (busy: boolean) => void; productName?: string }) {
  const id = useId();
  const model = useLocalModel();
  const [localEnabled, setLocalEnabled] = useState(true);
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState<WebSource[]>([]);
  const [product, setProduct] = useState<ProductResearch | null>(null);
  const [variantIndex, setVariantIndex] = useState("");
  const [selections, setSelections] = useState<Partial<Record<ProductFactKind, string>>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [retryTask, setRetryTask] = useState<RetryTask | null>(null);
  const [pasted, setPasted] = useState("");
  const request = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const autoFill = useRef(false);
  useImperativeHandle(ref, () => ({ fill(value) {
    const input = normalizeProductInput(value);
    setQuery(input);
    inputRef.current?.focus();
    if (input.length < 3) { setStatus("Enter a product name or paste a product link to fill its parameters."); return; }
    autoFill.current = true;
    if (product && (input === normalizeProductInput(query) || input === product.url || product.variants.some(v => v.url === input))) {
      if (product.recovery && ["not-found", "search-excerpt", "pasted-specs"].includes(product.recovery.method)) { setStatus("Review the recovered details below, then choose Fill out parameters to use them."); resultRef.current?.scrollIntoView({ behavior: "instant", block: "nearest" }); return; }
      const draft = makeProductDraft(product, variantIndex, selections);
      if (!draft) { setStatus("Choose your exact size or variant, then fill out parameters."); resultRef.current?.scrollIntoView({ behavior: "instant", block: "nearest" }); return; }
      if (Object.keys(draft).length > 3) { onUse(draft); setStatus("Parameters filled. Review your gear before saving."); return; }
    }
    void lookup(input);
  } }));
  useEffect(() => () => request.current?.abort(), []);

  async function readPageWithAI(fillAfterReading = false) {
    if (!product) return;
    setLocalEnabled(true);
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setRetryTask(null);
    setBusy(true); onBusyChange?.(true); setStatus("Reading the product page with Eco AI…");
    try {
      const result = await model.extractProduct(product, variantIndex);
      if (request.current !== controller) return;
      setProduct(result);
      const defaults = defaultSelections(variantIndex !== "" ? result.variants[Number(variantIndex)].facts : result.facts);
      setSelections(defaults);
      if (fillAfterReading) {
        const draft = makeProductDraft(result, variantIndex, defaults);
        if (draft) { onUse(draft); setStatus("Parameters filled. Review your gear before saving."); return; }
      }
      setStatus(result.recovery!.notice);
    } catch (error) {
      if (request.current === controller) {
        setStatus(error instanceof Error ? error.message : "Eco AI could not read this page. Your existing details are unchanged.");
        setRetryTask({ kind: "reading", autoFill: fillAfterReading });
      }
    } finally {
      if (request.current === controller) { setBusy(false); onBusyChange?.(false); }
    }
  }

  async function lookup(value: string, isPage = false, sourceName = "") {
    request.current?.abort();
    if (model.status === "thinking" || model.status === "loading") model.stop();
    const controller = new AbortController(); request.current = controller;
    const timer = setTimeout(() => controller.abort("timeout"), 55_000);
    setBusy(true); onBusyChange?.(true); setStatus(""); setProduct(null); setVariantIndex(""); setSelections({});
    setPasted("");
    if (!isPage) setSources([]);
    value = normalizeProductInput(value);
    sourceName = (sourceName || productName).slice(0, 240);
    const retry: RetryTask = { kind: "lookup", value, isPage, sourceName, autoFill: autoFill.current };
    setRetryTask(null);
    const page = isPage || /^https?:\/\//i.test(value.trim());
    try {
      const response = await fetch(page ? "/api/assistant/product" : `/api/assistant/research?kind=product&q=${encodeURIComponent(value.trim())}`, {
        cache: "no-store",
        ...(page ? { method: "POST", headers: await authHeaders(), body: JSON.stringify({ url: value.trim(), name: (sourceName || productName).slice(0, 240) }) } : {}), signal: controller.signal,
      });
      let data = await response.json();
      if (!response.ok) throw new Error(data.error || "This source is unavailable.");
      if (request.current !== controller) return;
      if (!page && !data.product && !data.sources?.length && localEnabled) {
        clearTimeout(timer);
        try {
          const queries = await model.researchQueries(value.trim());
          if (request.current !== controller) return;
          setStatus(model.status === "ready" ? "Eco AI planned another search. Reading matching public sources…" : "Searching public sources again…");
          const retried = await Promise.allSettled(queries.map(async q => {
            const retry = await fetch(`/api/assistant/research?kind=product&q=${encodeURIComponent(q)}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(55_000)]) });
            if (!retry.ok) throw new Error("Product research is unavailable.");
            return retry.json();
          }));
          if (request.current !== controller) return;
          const answers = retried.flatMap(r => r.status === "fulfilled" ? [r.value] : []);
          data = answers.find(result => result.product) ?? { sources: answers.flatMap(result => result.sources ?? []).filter((s: WebSource, i: number, all: WebSource[]) => all.findIndex(other => other.url === s.url) === i) };
        } catch (error) {
          if (request.current !== controller) return;
          setStatus(error instanceof Error ? error.message : "The AI search could not finish. Try the exact model or a product link.");
          setRetryTask(retry);
          return;
        }
      }
      if (!page && !data.product && data.sources?.length && localEnabled) {
        clearTimeout(timer);
        try {
          const ai = model.status === "ready";
          setStatus(ai ? "Eco AI is choosing product pages to open…" : "Opening the top matching product pages…");
          const picks = await model.selectLinks(value.trim(), data.sources as WebSource[]);
          if (request.current !== controller) return;
          if (picks.length) {
            setStatus(`Opening ${picks.length === 1 ? "a product page" : `${picks.length} product pages`}${ai ? " chosen by Eco AI" : ""}…`);
            const opened = await Promise.allSettled(picks.map(async source => {
              const pageResponse = await fetch("/api/assistant/product", {
                method: "POST",
                headers: await authHeaders(),
                body: JSON.stringify({ url: source.url, name: value.trim().slice(0, 240) }),
                cache: "no-store",
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(55_000)]),
              });
              if (!pageResponse.ok) throw new Error("Product page unavailable.");
              return pageResponse.json() as Promise<ProductResearch>;
            }));
            if (request.current !== controller) return;
            const products = opened.flatMap(r => r.status === "fulfilled" ? [r.value] : []);
            const richness = (p: ProductResearch) => new Set([...p.facts, ...p.variants.flatMap(v => v.facts)].map(f => f.kind)).size;
            const chosen = products.filter(p => [...p.facts, ...p.variants.flatMap(v => v.facts)].some(f => f.kind === "weight")).sort((a, b) => richness(b) - richness(a))[0]
              ?? products.find(p => p.readings?.length)
              ?? products.sort((a, b) => richness(b) - richness(a))[0];
            if (chosen) data = { product: chosen, sources: data.sources };
          }
        } catch (error) {
          if (request.current !== controller) return;
          // Keep the source list so the user can open a page manually.
          setSources(data.sources as WebSource[]);
          setStatus(error instanceof Error ? `${error.message} Choose a matching product below.` : "Eco AI could not open a product page. Choose a matching product below.");
          return;
        }
      }
      if (page || data.product) {
        let result = (page ? data : data.product) as ProductResearch;
        setProduct(result);
        if (result.recovery) setSources(result.recovery.sources.filter(s => s.url !== result.url));
        let selected = "";
        if (result.variants.length === 1) selected = "0";
        else if (result.variants.length) {
          const variantId = page ? new URL(value).searchParams.get("variant") : null;
          const index = variantId ? result.variants.findIndex(v => new URL(v.url).searchParams.get("variant") === variantId) : -1;
          if (index >= 0) selected = String(index);
        }
        setVariantIndex(selected);
        let aiNotice = "";
        if (localEnabled && result.recovery?.method === "not-found" && result.readings?.length && (!result.variants.length || selected !== "")) {
          clearTimeout(timer);
          setStatus("Standard lookup finished. Eco AI is reading the page text…");
          try { result = await model.extractProduct(result, selected); }
          catch (error) { aiNotice = error instanceof Error ? error.message : "Eco AI could not complete the reading. Available source details are still shown."; }
          if (request.current !== controller) return;
          setProduct(result);
        }
        const facts = selected !== "" ? result.variants[Number(selected)].facts : result.facts;
        const defaults = defaultSelections(facts);
        setSelections(defaults);
        if (aiNotice) setRetryTask({ kind: "reading", autoFill: autoFill.current });
        else if (result.recovery?.method === "not-found" || (!facts.length && !result.variants.length)) setRetryTask(retry);
        if (autoFill.current && (!result.recovery || ["catalog", "alternate-page", "local-ai"].includes(result.recovery.method)) && (!result.variants.length || selected !== "") && facts.length && Object.values(defaults).some(v => v !== "")) {
          const draft = makeProductDraft(result, selected, defaults);
          if (draft) { onUse(draft); setStatus("Parameters filled. Review your gear before saving."); return; }
        }
        setStatus(aiNotice || result.recovery?.notice || (result.variants.length && selected === "" ? "Choose your exact size or variant to see its specifications." : result.facts.length || result.variants.length ? "Specifications found. Review the values, then fill your gear form." : "No readable specifications found. Try another product link."));
      } else {
        setSources(data.sources);
        setStatus(data.sources.length ? `${data.sources.length} matches. Choose your product to read its specifications.` : "No matching product found. Try the exact brand and model, or paste a manufacturer or retailer link.");
        if (!data.sources.length) setRetryTask(retry);
      }
    } catch (e) {
      if (request.current === controller) {
        setStatus(controller.signal.aborted ? "Lookup timed out. Try another product link." : e instanceof Error ? e.message : "Lookup failed. Try another product link.");
        setRetryTask(retry);
      }
    } finally {
      clearTimeout(timer);
      if (request.current === controller) {
        setBusy(false); onBusyChange?.(false);
        resultRef.current?.scrollIntoView({ behavior: "instant", block: "nearest" });
      }
    }
  }
  const facts = product ? product.variants.length ? product.variants[Number(variantIndex)]?.facts ?? [] : product.facts : [];
  const hasVariant = !product?.variants.length || variantIndex !== "";
  const canApply = hasVariant && Object.values(selections).some(Boolean);
  return <div className="planner-product">
    <p id={`${id}-help`}>Paste a product link or enter its brand and model. Review weight, price, dimensions, capacity, and materials before saving.</p>
    <form className="planner-inline" onSubmit={e => { e.preventDefault(); autoFill.current = false; void lookup(query); }}>
      <label className="planner-grow">Product name or link<input ref={inputRef} value={query} disabled={busy} onChange={e => { setQuery(e.target.value); setRetryTask(null); }} placeholder="e.g. NEMO Tensor All-Season or https://…" maxLength={2000} minLength={3} required aria-describedby={`${id}-help`} /></label>
      <button className="planner-button secondary" disabled={busy}>{busy ? "Looking up…" : "Find product details"}</button>
      {busy && <button type="button" className="planner-link" onClick={() => { request.current?.abort(); request.current = null; model.stop(); setBusy(false); onBusyChange?.(false); setStatus("Lookup cancelled. You can enter details manually."); }}>Cancel lookup</button>}
    </form>
    <label className="planner-check"><input type="checkbox" checked={localEnabled} disabled={busy} onChange={e => setLocalEnabled(e.target.checked)} aria-describedby={`${id}-local-help`} />Use Eco AI to research missing details</label>
    <p id={`${id}-local-help`} className="planner-help">Hyked Eco AI (Llama 3.2, running on this device instead of a data center) can rephrase searches, pick product links to open, and extract specs from page text the app already fetched. On by default for missing details. First use downloads the browser model (~2 GB); WebGPU Chrome or Edge required.</p>
    <div ref={resultRef}><p id={`${id}-status`} role="status" className="planner-help">{busy ? model.status === "loading" ? "Loading Eco AI on this device…" : model.status === "thinking" ? model.message : "Checking the product page and alternate public sources…" : status}</p>
    {retryTask && !busy && <div className="planner-actions"><button type="button" className="planner-button secondary" aria-describedby={`${id}-status`} onClick={() => {
      if (retryTask.kind === "reading") void readPageWithAI(retryTask.autoFill);
      else { autoFill.current = retryTask.autoFill; void lookup(retryTask.value, retryTask.isPage, retryTask.sourceName); }
    }}>{retryTask.kind === "reading" ? "Retry AI reading" : "Retry lookup"}</button><span className="planner-help">{retryTask.kind === "reading" ? "Try the failed AI step again with the same product and size." : "Search again and check public sources for this product."}</span></div>}
    {model.status === "loading" && <progress aria-label="Eco AI download progress" value={model.progress} max={1} />}
    {model.message && <p className="planner-help planner-model-message" role="status">{model.message}</p>}
    {product && product.recovery?.method !== "catalog" && <div className="planner-local">
      {product.readings?.length ? <><button type="button" className="planner-button secondary" disabled={busy || !hasVariant} onClick={() => void readPageWithAI()}>{model.status === "ready" ? "Read page with Eco AI" : "Enable Eco AI & read page"}</button><p>{hasVariant ? "Extract missing details from the readable source text, then review the quoted evidence." : "Choose your exact size below before reading with Eco AI."}</p></> : <p>No readable page text was returned for Eco AI. Try another source link below. A local model cannot bypass a retailer’s access block.</p>}
      {model.status === "ready" && <button type="button" className="planner-link" disabled={busy} onClick={() => { model.stop(); setLocalEnabled(false); }}>Turn off Eco AI</button>}
    </div>}
    {status && !busy && !product && sources.length === 0 && query.trim().length >= 3 && <p className="planner-help"><a href={`https://www.google.com/search?q=${encodeURIComponent(`${query} product specifications`)}`} target="_blank" rel="noopener noreferrer">Find the exact product page</a>, then paste its link above. Some retailers block automated lookup.</p>}
    {sources.length > 0 && <details open={!product || !facts.length}><summary>{product?.recovery ? "Other possible product matches" : "Matching products"}</summary><ul className="planner-sources product-matches">{sources.map((s, i) => <li key={`${s.url}-${i}`}><div><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a><small>{new URL(s.url).hostname}</small></div><button className="planner-button secondary" type="button" disabled={busy} aria-label={`Read details for ${s.title}`} onClick={() => void lookup(s.url, true, s.title)}>Read details</button></li>)}</ul></details>}
    {product && <div className="planner-extracted">
      <h4>{product.title}</h4>
      {product.recovery?.method === "search-excerpt" && <p><strong>Unverified · search excerpt</strong></p>}
      {product.recovery?.method === "catalog" && <p><strong>Public catalog · dated source specifications</strong></p>}
      {product.recovery?.method === "local-ai" && <p><strong>Eco AI · verify source quotes</strong></p>}
      {product.recovery?.method === "alternate-page" && <p><strong>Alternate source · confirm the model</strong></p>}
      <p>Listed prices may change and exclude tax or delivery. Check what is included in each weight.</p>
      {product.variants.length > 0 && <label className="product-variant">Size / variant<select disabled={busy} value={variantIndex} onChange={e => { setVariantIndex(e.target.value); setRetryTask(null); setSelections(defaultSelections(e.target.value === "" ? [] : product.variants[Number(e.target.value)].facts)); }}><option value="">Choose your exact variant</option>{product.variants.map((v, i) => <option key={v.id} value={i}>{v.name}</option>)}</select></label>}
      {hasVariant && <div className="planner-fields">{PRODUCT_FIELDS.map(({ kind, label }) => {
        const options = facts.map((f, i) => ({ ...f, i })).filter(f => f.kind === kind);
        return <label key={kind}>{label}<select aria-label={label} aria-describedby={selections[kind] ? `${id}-${kind}-evidence` : undefined} disabled={busy || !options.length} value={selections[kind] ?? ""} onChange={e => setSelections(s => ({ ...s, [kind]: e.target.value }))}>
          <option value="">{options.length ? "Leave current value unchanged" : "Not found — enter manually"}</option>
          {["materials", "dimensions"].includes(kind) && options.length > 1 && <option value="all">Use all {label.toLowerCase()}</option>}
          {options.map(f => <option key={f.i} value={f.i}>{f.label}: {f.value}{f.requiresChoice ? " (confirm variant)" : ""}</option>)}
        </select>{options.length > 0 && selections[kind] && <small id={`${id}-${kind}-evidence`}>{selections[kind] === "all" ? options.map(f => f.evidence).join("; ") : facts[Number(selections[kind])]?.evidence}</small>}</label>;
      })}</div>}
      <p className="planner-help"><a href={variantIndex !== "" ? product.variants[Number(variantIndex)]?.url ?? product.url : product.url} target="_blank" rel="noopener noreferrer">Check source page</a> · Retrieved {new Date(product.retrievedAt).toLocaleDateString()}</p>
      <button type="button" className="planner-button" disabled={busy || !canApply} onClick={() => { const draft = makeProductDraft(product, variantIndex, selections); if (draft) { onUse(draft); setStatus("Details copied to your gear form. Review and save when ready."); } }}>Fill out parameters</button>
    </div>}
    {product?.recovery && product.recovery.method !== "catalog" && !busy && <details className="product-more"><summary>Extract details from copied specifications</summary><p className="planner-help">Open the product page yourself and paste its specification list here. Include units and the price currency. This text is processed in your browser.</p><label>Product specifications<textarea value={pasted} onChange={e => setPasted(e.target.value)} rows={5} maxLength={12000} placeholder={"Weight: 4.4 lb\nPacked size: 18 x 5 in\nPrice: 39.95 USD"} /></label><button type="button" className="planner-button secondary" disabled={!pasted.trim()} onClick={() => {
      const result = productFromPastedSpecs(pasted, productName || product.title, product.recovery!.requestedUrl);
      setProduct(result); setRetryTask(null); setVariantIndex(""); setSelections(defaultSelections(result.facts)); setSources([]);
      setStatus(result.facts.length ? result.recovery!.notice : "No labelled specifications found. Paste lines such as Weight: 4.4 lb or Packed size: 18 x 5 in, including units.");
      resultRef.current?.scrollIntoView({ behavior: "instant", block: "nearest" });
    }}>Extract pasted specifications</button></details>}
    </div>
  </div>;
}
