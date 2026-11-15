"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Search } from "lucide-react";
import { PEAK_DEFINITIONS } from "@/lib/trail-catalog/peaks";

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Opens the trail or peak directly when the search names one; otherwise shows matching results. */
export function TrailSearchForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
    if (!q) return router.push("/explore/trails/catalog");
    const nq = norm(q);
    const peak = PEAK_DEFINITIONS.find((p) => norm(p.name).includes(nq) || nq.includes(norm(p.name.split("(")[0])));
    if (peak && nq.length >= 3) return router.push(`/explore/trails/${encodeURIComponent(peak.id)}`);
    setBusy(true);
    try {
      const r = await fetch(`/api/trail-catalog?q=${encodeURIComponent(q)}&limit=5`);
      const d = r.ok ? await r.json() : null;
      const trails: { id: string; name: string }[] = d?.trails ?? [];
      const hit = trails.find((t) => norm(t.name) === nq) ?? trails.find((t) => norm(t.name).startsWith(nq)) ?? (trails.length === 1 ? trails[0] : undefined);
      if (hit) return router.push(`/explore/trails/${encodeURIComponent(hit.id)}`);
    } catch { /* fall through to results */ } finally { setBusy(false); }
    router.push(`/explore/trails/catalog?q=${encodeURIComponent(q)}`);
  }
  return <form onSubmit={submit} className="discovery-search" role="search"><Search size={20} aria-hidden /><label htmlFor="discovery-query" className="sr-only">Search trails</label><input id="discovery-query" name="q" type="search" placeholder="Search a trail, peak, park or city" /><button type="submit" className="btn-primary" aria-label="Search trails" disabled={busy}><ArrowUpRight size={22} aria-hidden /></button></form>;
}
