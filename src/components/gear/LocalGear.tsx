"use client";
import Link from "next/link";
import { formatProductPrice } from "@/lib/assistant/product-draft";
import { useRef, useState } from "react";
import { GearEditor } from "@/components/assistant/GearEditor";
import { usePlannerMemory } from "@/components/assistant/usePlannerMemory";
import type { PlannerGear } from "@/lib/assistant/types";
import "@/components/assistant/planner.css";
import { noteGuestProgress } from "@/components/nav/GuestSaveBanner";

export function LocalGear({ userId = null, accountStorageUnavailable = false }: { userId?: string | null; accountStorageUnavailable?: boolean }) {
  const { memory, update, error } = usePlannerMemory(userId);
  const [editing, setEditing] = useState<PlannerGear | null>(null);
  const [removed, setRemoved] = useState<PlannerGear | null>(null);
  const editor = useRef<HTMLDivElement>(null);
  const knownOz = memory.gear.reduce((sum, item) => sum + (item.weightOz ?? 0) * item.qty, 0);
  const unknown = memory.gear.filter(item => item.weightOz === null).length;
  function save(gear: PlannerGear) {
    const saved = update(m => ({ ...m, gear: [...m.gear.filter(g => g.id !== gear.id), gear] }));
    if (saved) { setEditing(null); if (!userId) noteGuestProgress(); }
    return saved;
  }
  function focusEditor() { editor.current?.scrollIntoView({ behavior: "instant", block: "start" }); editor.current?.querySelector("input")?.focus(); }
  return <div className="planner-shell">
    <header className="local-gear-heading"><div><h1>Your gear, ready to go.</h1><p className="fieldbook-page-intro">One equipment list for every trip. Saved in this browser.</p></div><Link className="planner-button" href="/plan">Plan with this gear</Link></header>
    {accountStorageUnavailable && <p className="planner-notice" role="status">Account gear storage is not set up yet. You can add gear and plan trips here; your gear is saved in this browser for your account and will not sync to other devices.</p>}
    <div className="planner-layout"><section className="planner-workspace" aria-label="Your equipment">
      <div className="planner-section-heading"><h2>Your equipment</h2><button className="planner-button secondary" onClick={() => { setEditing(null); focusEditor(); }}>Add gear</button></div>
      {memory.gear.length ? <div className="local-gear-list">{memory.gear.map(g => <div className="planner-gear-row" key={g.id}><div><strong>{g.name}{g.qty > 1 ? ` ×${g.qty}` : ""}</strong><small>{g.category} · {g.type}{g.packedSize ? ` · ${g.packedSize}` : ""}</small>{g.price != null && g.priceCurrency && <small>{formatProductPrice(g.price, g.priceCurrency)} each</small>}{g.sourceNote && <small>{g.sourceNote}</small>}</div><span className="planner-numeric">{g.weightOz === null ? "Weight unknown" : `${(g.weightOz * g.qty).toFixed(1)} oz`}</span><button className="planner-link" aria-label={`Edit ${g.name}`} onClick={() => { setEditing(g); focusEditor(); }}>Edit</button><button className="planner-link" aria-label={`Remove ${g.name}`} onClick={() => { if (update(m => ({ ...m, gear: m.gear.filter(item => item.id !== g.id) }))) setRemoved(g); }}>Remove</button></div>)}</div> : <div className="planner-intro"><h3>Start with what you own.</h3><p>Add your backpack, shelter and sleep system first. Enter weights you know, or look up a product’s specifications below.</p></div>}
      {removed && <p className="planner-notice" role="status">{removed.name} removed. <button className="planner-link" onClick={() => { if (save(removed)) setRemoved(null); }}>Undo removal</button></p>}
      <div ref={editor} className="local-gear-editor"><h3>{editing ? `Edit ${editing.name}` : "Add equipment"}</h3><GearEditor key={editing?.id ?? "new"} initial={editing ?? undefined} onSave={save} onCancel={editing ? () => setEditing(null) : undefined} /></div>
      <p className="planner-alert" role="status">{error}</p>
    </section><aside className="planner-sidebar local-gear-aside"><h2>Know your equipment.</h2><p>{memory.gear.length} items · {(knownOz / 16).toFixed(1)} lb of known inventory weight{unknown ? ` · ${unknown} missing ${unknown === 1 ? "weight" : "weights"}` : ""}</p><p>Your trip’s pack weight uses only the items you select, plus food, water and fuel. Worn items are counted separately.</p><hr /><h3>Weights with a source</h3><p>Look up a product name or paste its manufacturer’s page in the equipment editor. Review specifications before adding them.</p><hr /><h3>Your browser, your gear</h3><p>{userId ? "This browser’s gear is shared with your planner for this account. Keep using the same browser to access it. Cloud syncing is unavailable until account storage is set up." : "This guest list is shared with your local planner. Sign in to work with account gear; guest and account inventories stay separate."}</p>{!userId && <Link className="planner-button secondary" href="/login?next=/gear">Sign in to account gear</Link>}</aside></div>
  </div>;
}
