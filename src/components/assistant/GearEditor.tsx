"use client";
import { useRef, useState } from "react";
import { CATEGORY_ORDER } from "@/lib/gear";
import type { PlannerGear, ProductDetails } from "@/lib/assistant/types";
import { optionalNumber } from "@/lib/assistant/planning";
import { ProductDetailsFields } from "./ProductDetailsFields";
import { productLookupInput } from "@/lib/assistant/product-input";
import { ProductLookup, type ProductLookupHandle } from "./ProductLookup";
export function GearEditor({ onSave, initial, onCancel }: { onSave: (gear: PlannerGear) => boolean; initial?: PlannerGear; onCancel?: () => void }) {
  const productLookup = useRef<ProductLookupHandle>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const lookupDetails = useRef<HTMLDetailsElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial?.name ?? "");
  const [weight, setWeight] = useState(initial?.weightOz?.toString() ?? "");
  const [unit, setUnit] = useState("oz");
  const [size, setSize] = useState(initial?.packedSize ?? "");
  const [category, setCategory] = useState<PlannerGear["category"]>(initial?.category ?? "Misc");
  const [type, setType] = useState<PlannerGear["type"]>(initial?.type ?? "Base");
  const [qty, setQty] = useState(initial?.qty ?? 1);
  const [source, setSource] = useState(initial?.sourceUrl ?? "");
  const [details, setDetails] = useState<ProductDetails>(() => ({ price: initial?.price, priceCurrency: initial?.priceCurrency, brand: initial?.brand, model: initial?.model, sku: initial?.sku, capacity: initial?.capacity, materials: initial?.materials, dimensions: initial?.dimensions, sourceCheckedAt: initial?.sourceCheckedAt, sourceNote: initial?.sourceNote }));
  const [notice, setNotice] = useState("");
  function fillParameters() {
    const input = productLookupInput(name, source);
    if (!input) { setNotice("Enter an item name or product link first."); nameInput.current?.focus(); return; }
    setNotice("");
    if (lookupDetails.current) lookupDetails.current.open = true;
    productLookup.current?.fill(input);
  }
  return <div className="planner-gear-editor">
    <details ref={lookupDetails}><summary>Fill details from a product name or link</summary><ProductLookup ref={productLookup} productName={name} onBusyChange={setLookingUp} onUse={draft => {
      const { name: foundName, weightOz, packedSize, sourceUrl, ...metadata } = draft;
      setName(foundName.slice(0, 180));
      if (weightOz !== undefined) { setWeight(String(weightOz)); setUnit("oz"); }
      if (packedSize !== undefined) setSize(packedSize);
      setSource(sourceUrl); setDetails(current => ({ ...current, ...metadata }));
      setNotice("Product details filled below. Review the fields, then save your gear.");
      if (lookupDetails.current) lookupDetails.current.open = false;
      nameInput.current?.focus();
    }} /></details>
    <form onSubmit={e => { e.preventDefault(); if (!name.trim()) { setNotice("Enter an item name before saving."); e.currentTarget.querySelector("input")?.focus(); return; } const number = optionalNumber(weight, 0.001, 100000); const saved = onSave({ ...details, id: initial?.id ?? `local:${crypto.randomUUID()}`, name: name.trim(), category, type, qty, weightOz: number === null ? null : number * ({ oz: 1, lb: 16, g: 1/28.349523125, kg: 35.27396195 }[unit] ?? 1), packedSize: size.trim() || null, sourceUrl: source || null }); if (!saved) { setNotice("This item could not be saved yet. Wait for your account to finish loading and try again."); return; } if (!initial) { setName(""); setWeight(""); setSize(""); setSource(""); setDetails({}); } setNotice(initial ? "Item updated." : "Added to your gear."); }}>
      <div className="planner-fields">
        <label className="planner-span">Item name<input ref={nameInput} value={name} onChange={e => setName(e.target.value)} maxLength={180} required /></label>
        <label>Weight per item<input type="number" step="any" min="0.001" max="16000" value={weight} onChange={e => setWeight(e.target.value)} placeholder="Unknown" /></label>
        <label>Unit<select value={unit} onChange={e => setUnit(e.target.value)}><option>oz</option><option>lb</option><option>g</option><option>kg</option></select></label>
        <label>Category<select value={category} onChange={e => setCategory(e.target.value as PlannerGear["category"])}>{CATEGORY_ORDER.map(c => <option key={c}>{c}</option>)}</select></label>
        <label>Carried as<select value={type} onChange={e => setType(e.target.value as PlannerGear["type"])}><option>Base</option><option>Worn</option><option>Consumable</option></select></label>
        <label>Quantity<input type="number" min="1" max="1000" step="1" required value={qty} onChange={e => setQty(Number(e.target.value))} /></label>
        <label>Packed dimensions<input value={size} onChange={e => setSize(e.target.value)} placeholder="e.g. 20 × 5.5 in" maxLength={160} /></label>
        <label className="planner-span">Specification source (optional)<input type="url" pattern="https://.*" value={source} onChange={e => setSource(e.target.value)} placeholder="https://…" maxLength={2000} /></label>
      </div>
      <ProductDetailsFields value={details} onChange={setDetails} />
      {details.sourceCheckedAt && <p className="planner-help">Product source checked {new Date(details.sourceCheckedAt).toLocaleDateString()}. Prices may change.</p>}
      <p className="planner-help">Leave unknown weights empty. Product dimensions alone cannot confirm that everything fits in your pack.</p>
      <div className="planner-actions"><button className="planner-button secondary">{initial ? "Save item changes" : "Add to my gear"}</button>{onCancel && <button type="button" className="planner-link" onClick={onCancel}>Close editor</button>}<button type="button" className="planner-button" disabled={lookingUp} onClick={fillParameters}>{lookingUp ? "Filling parameters…" : "Fill out parameters"}</button></div>
      <p role="status" className="planner-help">{notice}</p>
    </form>
  </div>;
}
