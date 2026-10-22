"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { EMPTY_REQUEST, followUpQuestions, inferHistory, optionalNumber, gearWeightOz, packReport, parseTripRequest, preparationChecks, rankRoutes, REFERENCES } from "@/lib/assistant/planning";
import type { PlannerContext, PlannerGear, PlannerProfile, RouteCandidate, SavedPlan, TripFeedback, TripRequest, TrailResearchSource, ShoppingItem } from "@/lib/assistant/types";
import { gearResearchGaps } from "@/lib/assistant/route-fit";
import { planInsights } from "@/lib/assistant/insights";
import { tripChecklist } from "@/lib/assistant/checklist";
import { emptyMemory } from "@/lib/assistant/memory";
import { GearEditor } from "./GearEditor";
import { PackWeightBreakdown } from "./PackWeightBreakdown";
import { PackInventory } from "./PackInventory";
import { PackingGuide } from "./PackingGuide";
import { formatPackWeight, type PackUnits } from "@/lib/assistant/packing";
import { usePlannerMemory } from "./usePlannerMemory";
import { useLocalModel } from "./useLocalModel";
import { PlaceSearch } from "./PlaceSearch";
import { TripShoppingList } from "./TripShoppingList";
import { shoppingForTrip, shoppingText } from "@/lib/assistant/shopping";
import { CatalogSuggestions } from "./CatalogSuggestions";
import { LocalOutdoorAiChat } from "./LocalOutdoorAiChat";
import "./planner.css";
import { noteGuestProgress } from "@/components/nav/GuestSaveBanner";

function NumberField({ label, value, onChange, min = 0, max = 10000, step = "any", hint }: { label: string; value: number | null; onChange: (n: number | null) => void; min?: number; max?: number; step?: string; hint?: string }) {
  return <label>{label}<input type="number" min={min} max={max} step={step} value={value ?? ""} onChange={e => onChange(optionalNumber(e.target.value, min, max))} placeholder="Not set" />{hint && <small>{hint}</small>}</label>;
}
function FeedbackForm({ plan, onSave }: { plan: SavedPlan; onSave: (feedback: TripFeedback) => void }) {
  const [feedback, setFeedback] = useState<TripFeedback>(plan.feedback ?? { effort: "right", packComfort: "comfortable", carriedLb: null, notes: "" });
  return <form className="planner-feedback" onSubmit={e => { e.preventDefault(); onSave(feedback); }}>
    <p>After you complete the trip, tell the planner what actually worked.</p>
    <div className="planner-fields">
      <label>Daily distance felt<select value={feedback.effort} onChange={e => setFeedback({ ...feedback, effort: e.target.value as TripFeedback["effort"] })}><option value="easy">Easy</option><option value="right">About right</option><option value="hard">Too hard</option></select></label>
      <label>Pack felt<select value={feedback.packComfort} onChange={e => setFeedback({ ...feedback, packComfort: e.target.value as TripFeedback["packComfort"] })}><option value="comfortable">Comfortable</option><option value="too-heavy">Too heavy</option></select></label>
      <NumberField label="Actual starting pack (lb)" value={feedback.carriedLb} min={1} max={150} onChange={carriedLb => setFeedback({ ...feedback, carriedLb })} />
      <label>What would you change?<input value={feedback.notes} onChange={e => setFeedback({ ...feedback, notes: e.target.value })} maxLength={500} /></label>
    </div><button className="planner-button secondary">{plan.feedback ? "Update completed-trip feedback" : "Mark completed & remember feedback"}</button>
  </form>;
}
export function TripPlanner({ context, initialRegion = "", initialPrompt = "", initialRoute = null, initialDays = null }: { context: PlannerContext; initialRegion?: string; initialPrompt?: string; initialRoute?: RouteCandidate | null; initialDays?: number | null }) {
  const { memory, update, error: memoryError, loading: memoryLoading } = usePlannerMemory(context.userId);
  const signedIn = Boolean(context.userId);
  // Started from a personal trail or a built route: the trip opens on that route, ready to pack for.
  const startDays = initialRoute ? initialDays ?? Math.max(1, Math.ceil(initialRoute.distanceMiles / 12)) : null;
  const model = useLocalModel();
  const router = useRouter();
  const stopModel = model.stop;
  const [accountChanged, setAccountChanged] = useState(false);
  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if ((session?.user.id ?? null) !== context.userId) {
        setAccountChanged(true);
        stopModel();
        router.refresh();
      }
    });
    return () => subscription.unsubscribe();
  }, [context.userId, router, stopModel]);
  const [prompt, setPrompt] = useState(initialRoute ? `${initialRoute.distanceMiles} miles, ${startDays} ${startDays === 1 ? "day" : "days"} on ${initialRoute.name}` : initialPrompt || (initialRegion ? `A trip in ${initialRegion}` : ""));
  const [request, setRequest] = useState<TripRequest>(initialRoute ? { ...EMPTY_REQUEST, region: initialRoute.region, distanceMiles: initialRoute.distanceMiles, days: startDays } : { ...EMPTY_REQUEST, region: initialRegion });
  const [started, setStarted] = useState(Boolean(initialRoute));
  const [step, setStep] = useState(initialRoute ? 1 : 0);
  const [units, setUnits] = useState<PackUnits>("imperial");
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [savedSignature, setSavedSignature] = useState("");
  const gearForm = useRef<HTMLDetailsElement>(null);
  const stageHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (started) stageHeading.current?.focus();
  }, [started, step]);
  const [route, setRoute] = useState<RouteCandidate | null>(initialRoute);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [shopping, setShopping] = useState<ShoppingItem[]>([]);
  const [packed, setPacked] = useState<string[]>([]);
  const [editing, setEditing] = useState<PlannerGear | null>(null);
  const [explanation, setExplanation] = useState<string[]>([]);
  const [explainedSignature, setExplainedSignature] = useState("");
  const [aiError, setAiError] = useState("");
  const [notice, setNotice] = useState("");
  const [forgetPending, setForgetPending] = useState(false);
  const [sources, setSources] = useState<TrailResearchSource[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchSequence = useRef(0);
  const searchController = useRef<AbortController | null>(null);
  const [researchingRoute, setResearchingRoute] = useState("");
  const researchPanel = useRef<HTMLDetailsElement>(null);
  useEffect(() => () => { searchController.current?.abort(); }, []);
  const inventory = useMemo(() => [...new Map([...context.gear, ...memory.gear].map(g => [g.id, g])).values()], [context.gear, memory.gear]);
  const selected = inventory.filter(g => !excluded.includes(g.id));
  const history = inferHistory(memory.profile, memory.plans, context.activities);
  const report = packReport(selected, request, history.comfortablePackLb);
  const matches = rankRoutes(request, context.routes, { usualMilesPerDay: history.usualMilesPerDay, experience: memory.profile.experience, packOverTarget: report.overTarget });
  const gearGaps = gearResearchGaps(selected, request);
  const milesPerDay = request.days ? (route?.distanceMiles ?? request.distanceMiles ?? 0) / request.days : null;
  const followUps = followUpQuestions(request, { ...memory.profile, comfortablePackLb: history.comfortablePackLb, usualMilesPerDay: history.usualMilesPerDay }, selected);
  function togglePacked(id: string, checked: boolean) { setPacked(ids => checked ? [...new Set([...ids, id])] : ids.filter(item => item !== id)); }
  function setTrip(patch: Partial<TripRequest>) {
    setRequest(current => ({ ...current, ...patch, ...("region" in patch || "locationMode" in patch ? { place: null } : {}) }));
    if ("region" in patch || "locationMode" in patch || "place" in patch || "radiusKm" in patch) setRoute(null); setExplanation([]); setNotice("");
    if ("region" in patch || "distanceMiles" in patch || "days" in patch) { searchController.current?.abort(); ++searchSequence.current; setSources([]); setSearching(false); setResearchingRoute(""); setSearchError("Trip details changed. Refresh online research for this request."); }
  }
  function setProfile(patch: Partial<PlannerProfile>) { update(m => ({ ...m, profile: { ...m.profile, ...patch } })); setExplanation([]); }
  function saveGear(gear: PlannerGear) { const saved = update(m => ({ ...m, gear: [...m.gear.filter(g => g.id !== gear.id), gear] })); if (saved) { setEditing(null); setExplanation([]); } return saved; }
  async function findSources(trip: TripRequest, routeName = "") {
    searchController.current?.abort();
    const controller = new AbortController(); searchController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 25_000);
    const sequence = ++searchSequence.current; setSearching(true); setSearchError(""); setSources([]);
    setResearchingRoute(routeName);
    try {
      const q = `${routeName} ${trip.region} ${trip.distanceMiles ?? ""} mile ${trip.days ?? ""} day`.trim().slice(0, 180);
      const response = await fetch(`/api/assistant/research?kind=trail&q=${encodeURIComponent(q)}`, { signal: controller.signal });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (sequence === searchSequence.current) { setSources(data.sources); if (!data.sources.length) setSearchError("No online matches returned. Try a more specific region or use the web search link."); }
    } catch (error) { if (sequence === searchSequence.current) setSearchError(controller.signal.aborted ? "Trail research timed out. Try again; your route comparisons remain available." : error instanceof Error ? error.message : "Search failed. Try again."); }
    finally { clearTimeout(timeout); if (sequence === searchSequence.current) setSearching(false); }
  }
  function buildTrip() {
    searchController.current?.abort(); ++searchSequence.current; setSources([]); setSearchError(""); setSearching(false); setResearchingRoute("");
    setActivePlanId(null); setSavedSignature("");
    const parsed = parseTripRequest(prompt); setRequest(parsed); setStarted(true); noteGuestProgress(); setStep(0); setRoute(null); setPacked([]); setShopping([]); setExcluded([]); setExplanation([]); setNotice("");
    if (parsed.region) void findSources(parsed);
  }
  const insights = planInsights(request, route, selected, memory.profile, memory.plans, context.activities);
  const aiContext = { priorities: memory.profile.priorities, experience: memory.profile.experience, recentFeedback: memory.plans.filter(p => p.feedback).slice(0, 3).map(p => p.feedback) };
  const aiSignature = JSON.stringify({ insights, aiContext });
  async function explain() {
    setAiError("");
    try {
      if (model.status !== "ready" && !await model.load()) {
        setAiError("The local model could not start. Retry to reload it and explain this plan."); return;
      }
      const result = await model.explain(aiContext, insights); setExplanation(result); setExplainedSignature(aiSignature);
    }
    catch (error) { setAiError(error instanceof Error ? error.message : "Could not generate an explanation. The calculated plan is still available."); }
  }
  const planSignature = JSON.stringify({ prompt, request, route, gear: selected, shopping, packed: packed.filter(id => selected.some(g => g.id === id)) });
  function savePlan() {
    const id = activePlanId ?? crypto.randomUUID();
    const plan: SavedPlan = { id, prompt, request, route, gear: selected, shopping, packedIds: packed.filter(id => selected.some(g => g.id === id)), savedAt: new Date().toISOString(), feedback: memory.plans.find(p => p.id === id)?.feedback ?? null };
    if (update(m => ({ ...m, plans: [plan, ...m.plans.filter(p => p.id !== id)].slice(0, 30) }))) {
      setActivePlanId(id); setSavedSignature(planSignature);
      setNotice(signedIn ? "Trip and shopping list saved to your account. Add feedback after your outing to improve the next plan." : "Trip saved for this visit. Sign in to keep it on every device.");
    }
  }
  function downloadChecklist() {
    const url = URL.createObjectURL(new Blob([tripChecklist(request, route, selected, packed, units), "\n", shoppingText(shoppingForTrip(request, inventory, shopping))], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "hyked-checklist.txt"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(signedIn ? "Checklist prepared for download. Save this trip to keep your progress in your account too." : "Checklist prepared for download. Sign in and save this trip to keep your progress.");
  }
  function newTrip() {
    searchController.current?.abort(); ++searchSequence.current; setSources([]); setSearchError(""); setSearching(false); setResearchingRoute("");
    setStarted(false); setStep(0); setRoute(null); setPrompt(""); setRequest({ ...EMPTY_REQUEST }); setPacked([]); setShopping([]); setExcluded([]); setActivePlanId(null); setSavedSignature(""); setExplanation([]); setNotice("");
  }
  function restore(plan: SavedPlan) {
    update(m => ({ ...m, gear: [...new Map([...m.gear, ...plan.gear].map(g => [g.id, g])).values()] }));
    setActivePlanId(plan.id); setSavedSignature(JSON.stringify({ prompt: plan.prompt, request: plan.request, route: plan.route, gear: plan.gear, shopping: plan.shopping ?? [], packed: plan.packedIds }));
    setShopping(plan.shopping ?? []); setPrompt(plan.prompt); setRequest(plan.request); setRoute(plan.route); setPacked(plan.packedIds); setExcluded(inventory.filter(g => !plan.gear.some(p => p.id === g.id)).map(g => g.id)); setStarted(true); setStep(plan.route ? 1 : 0); setExplanation([]); setNotice("Saved trip restored."); void findSources(plan.request);
  }
  if (accountChanged) return <div className="planner-shell" role="status">Updating your planning account… <button className="planner-link" onClick={() => window.location.reload()}>Reload planner</button></div>;
  return <div className="planner-shell">
    {started && route && step > 0 && <div className="planner-topline"><Link href="/plan">My trips</Link><button className="planner-button" onClick={newTrip}>New trip</button></div>}
    <header className="planner-heading"><div><h1>{route && step > 0 ? route.name : "Your trip, taking shape."}</h1><p>{route && step > 0 ? route.region : "Find a route. Prepare your pack. Make it your next outing."}</p></div>{started && <span className="planner-save-state">{savedSignature === planSignature ? (signedIn ? "Saved to your account" : "Saved for this visit") : "Unsaved changes"}</span>}</header>
    {started && route && step > 0 && <div className="planner-trip-banner"><div className="planner-landscape" role="img" aria-label="Illustrated mountain landscape, not a photograph of this route"><span>Planning illustration</span></div><div className="planner-trip-stats"><span>{route.distanceMiles} mi</span><span>{request.days ?? "—"} days</span><span>{request.startDate || "Dates to decide"}</span><button className="planner-link" onClick={() => setStep(0)}>Edit trip</button></div></div>}
    <nav className="planner-steps" aria-label="Trip planning steps">{["Choose a trail", "Prepare your pack", "Record your outing"].map((label, i) => <button key={label} disabled={!started && i > 0} aria-current={step === i ? "step" : undefined} onClick={() => setStep(i)}><span>{i+1}</span>{label}</button>)}</nav>
    <div className="planner-layout">
      <div className="planner-workspace">
        {!started && <form className="planner-prompt" onSubmit={e => { e.preventDefault(); buildTrip(); }}>
          <label htmlFor="trip-prompt">What do you have in mind?</label>
          {!prompt && <button type="button" className="planner-example" onClick={() => setPrompt("30 miles, 3 days in Colorado")}>Start with an example: <strong>3 days, 30 miles in Colorado</strong></button>}
          <textarea id="trip-prompt" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Describe your trip: where, how far, how many days" maxLength={1500} required rows={2} />
          <div className="planner-prompt-footer"><button className="planner-button">Build my trip <span aria-hidden="true">→</span></button></div>
        </form>}
        {!started && <div className="planner-intro"><h2>Your next trip, informed by your last.</h2><p>Start with a distance, number of days, and region. We’ll find route options, calculate the gear you’re carrying, and arrange it into a packing checklist.</p><p className="planner-help">Your account’s gear and hikes are used when you’re signed in. Add preferences and trip feedback here to make recommendations more personal.</p></div>}
        {!started && <LocalOutdoorAiChat onApplyPrompt={(p) => { setPrompt(p); window.scrollTo({ top: 0, behavior: "smooth" }); }} />}
        {started && <>
          {step === 0 && <div className="planner-request-summary"><h2>{request.distanceMiles ? `${request.distanceMiles} miles` : "Choose your mileage"}{request.days ? ` over ${request.days} ${request.days === 1 ? "day" : "days"}` : ""}{request.region ? ` ${request.locationMode === "near" ? "near" : "in"} ${request.region}` : ""}</h2><div><p>{request.region} · About {request.distanceMiles ?? "—"} mi · {request.days ?? "—"} days</p><button className="planner-button secondary" onClick={() => setStarted(false)}>Edit request</button></div></div>}
          {step === 0 && <section className="planner-stage" aria-labelledby="trail-title">
            <div className="planner-section-heading"><div><h2 id="trail-title" ref={stageHeading} tabIndex={-1}>{matches.length === 1 ? "One route to investigate" : "Find your route"}</h2>{!matches.length && <p>Choose a place, compare mapped trails and select one to prepare your trip.</p>}</div></div>
            <div className="planner-fields"><label>Location search<select value={request.locationMode ?? "in"} onChange={e => setTrip({ locationMode: e.target.value as "in" | "near" })}><option value="in">In a state or region</option><option value="near">Near a place or landmark</option></select></label><label>Place or region<input value={request.region} maxLength={100} onChange={e => setTrip({ region: e.target.value })} /></label></div>
            {request.locationMode === "near" && request.region.trim() && <PlaceSearch key={request.region} request={request} onChange={setTrip} />}
            <CatalogSuggestions key={JSON.stringify([request.region, request.locationMode, request.place, request.radiusKm, request.distanceMiles])} request={request} onSelect={candidate => { setRoute(candidate); setStep(1); setExplanation([]); }} />
            <section className="planner-route-fit" aria-label="Your trip fit"><h3>Compared with your usual trips</h3><p>Guide routes compare distance, daily mileage and experience. Mapped trails stay within your chosen area; use their length and map to plan your itinerary.</p>
              <div className="planner-fields"><NumberField label="Usual comfortable miles per day" value={memory.profile.usualMilesPerDay} min={0.1} max={100} onChange={usualMilesPerDay => setProfile({ usualMilesPerDay })} hint={history.usualMilesPerDay && memory.profile.usualMilesPerDay === null ? `Using ${history.usualMilesPerDay.toFixed(1)} mi/day from completed-trip feedback.` : "Saved in your trip preferences."} /><label>Overnight experience<select value={memory.profile.experience} onChange={e => setProfile({ experience: e.target.value as PlannerProfile["experience"] })}><option value="new">Getting started</option><option value="some">Some overnight trips</option><option value="experienced">Experienced</option></select></label></div>
              <p>{report.complete ? "Calculated starting pack" : "Known selected pack weight"}: <strong>{formatPackWeight(report.loadedLb * 16, units)}</strong>{history.comfortablePackLb ? ` · Personal target ${formatPackWeight(history.comfortablePackLb * 16, units)}` : " · Add a comfortable carrying target in My trip preferences."}{report.overTarget ? " Already above your target." : !report.complete ? " Add missing weights and supply amounts before comparing your full load." : ""}</p>
              {gearGaps.length > 0 && <ul>{gearGaps.map(gap => <li key={gap}>{gap}</li>)}</ul>}
              <p className="planner-help">This comparison does not confirm camping permission, current access, water or weather. <a href="#trip-details" onClick={() => { const details = document.getElementById("trip-details") as HTMLDetailsElement | null; if (details) details.open = true; }}>Adjust mileage, days or location</a>.</p>
            </section>
            <div className="planner-route-list">{matches.map(({ route: candidate, difference, reasons, cautions, suggestedDays }) => <article key={candidate.id} className={`planner-route ${route?.id === candidate.id ? "selected" : ""}`}>

              <h3>{candidate.name}</h3><p>{candidate.region}</p>
              <div className="planner-route-meta"><span>{candidate.difficulty}</span><span>{difference < 0.1 ? "Your target distance" : `${difference.toFixed(0)} mi from your target`}</span></div>
              <div className="planner-route-stats"><strong>{candidate.distanceMiles} <small>miles</small></strong>{request.days && <strong>{(candidate.distanceMiles/request.days).toFixed(1)} <small>mi/day</small></strong>}{candidate.elevationFt != null && <strong>{candidate.elevationFt.toLocaleString()} <small>ft gain</small></strong>}</div>
              <ul className="planner-route-reasons">{[...reasons, ...cautions].map(reason => <li key={reason}>{reason}</li>)}</ul>
              {suggestedDays && suggestedDays <= 365 && <button className="planner-link" onClick={() => { setTrip({ days: suggestedDays }); setNotice(`Comparing routes over ${suggestedDays} days. Review campsites and the actual daily itinerary before choosing.`); stageHeading.current?.focus(); }}>Compare over {suggestedDays} days at your usual pace</button>}
              <p className="planner-help">{candidate.note}</p>
              <button className="planner-link" onClick={() => { if (researchPanel.current) { researchPanel.current.open = true; researchPanel.current.scrollIntoView({ behavior: "instant", block: "start" }); } void findSources(request, candidate.name); }}>Research {candidate.name}</button>
              <div className="planner-actions">{candidate.sourceUrl ? <a href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer">{candidate.sourceLabel}</a> : <span className="planner-help">{candidate.sourceLabel}</span>}<button className="planner-button" onClick={() => { setRoute(candidate); setStep(1); setExplanation([]); }}>{route?.id === candidate.id ? "Selected" : "Use this route & prepare"}</button></div>
            </article>)}</div>
            {matches.length === 0 && request.locationMode !== "near" && <p className="planner-help">No complete route in the saved guide matches this request. Choose a mapped trail above or research a complete itinerary below.</p>}
            <details ref={researchPanel} className="planner-details" open={matches.length === 0 && request.locationMode !== "near"}><summary>{researchingRoute ? `Research: ${researchingRoute}` : "Research more trips in this region"}</summary><p className="planner-help">Search uses your location, mileage and days. Park and land-manager sources appear first. Search excerpts are leads; confirm the complete itinerary, distance and current rules on the linked page.</p>
              <p role="status">{searching ? "Finding public trail sources…" : searchError}</p>
              <ul className="planner-sources">{sources.map((s, i) => <li key={`${s.url}-${i}`}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a><small>{s.publisher}{s.topics?.length ? ` · ${s.topics.join(" · ")}` : ""}</small><p>{s.snippet}</p><small>Search retrieved {new Date(s.retrievedAt).toLocaleDateString()} · Current conditions not verified</small></li>)}</ul>
              <div className="planner-actions"><button className="planner-link" disabled={searching || !request.region} onClick={() => void findSources(request, researchingRoute)}>{searchError ? "Retry trail research" : "Search again"}</button><a href={`https://www.google.com/search?q=${encodeURIComponent(`${researchingRoute} ${request.region} ${request.distanceMiles ?? ""} mile ${request.days ?? ""} day backpacking official trails`)}`} target="_blank" rel="noopener noreferrer">Open web search</a></div>
            </details>
            <details className="planner-details"><summary>Add a route you found</summary><form className="planner-fields" onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); setRoute({ id: `manual:${crypto.randomUUID()}`, name: String(data.get("name")), region: request.region, distanceMiles: Number(data.get("distance")), elevationFt: null, difficulty: "Check source", sourceUrl: String(data.get("source")), sourceLabel: "Your route source", note: "Route entered from your source. Verify its distance, conditions, and overnight rules before travel." }); setExplanation([]); }}>
              <label>Route name<input name="name" required maxLength={180} /></label><label>Route distance (mi)<input name="distance" type="number" min="0.1" max="10000" step="any" required /></label><label className="planner-span">Official route URL<input name="source" type="url" pattern="https://.*" required maxLength={2000} /></label><button className="planner-button secondary">Use this route</button>
            </form></details>
            {route && <p className="planner-fit">Selected: {route.name} · {route.distanceMiles} miles</p>}
            <button className="planner-button" onClick={() => setStep(1)}>Prepare my pack <span aria-hidden="true">→</span></button>
          </section>}
          {step === 1 && <section className="planner-stage" aria-labelledby="pack-title">
            <div className="planner-section-heading"><div><h2 id="pack-title" ref={stageHeading} tabIndex={-1}>Your packing list.</h2></div><button className="planner-button secondary" onClick={() => { if (gearForm.current) { gearForm.current.open = true; gearForm.current.scrollIntoView({ behavior: "instant", block: "center" }); gearForm.current.querySelector("input")?.focus(); } }}>Add gear</button></div>
            {route?.kind === "segment" && <p className="planner-alert">{route.note} {route.catalogHref && <Link href={route.catalogHref} target="_blank" rel="noopener noreferrer">Review trail map</Link>}</p>}
            <TripShoppingList request={request} inventory={inventory} selected={selected} edits={shopping} onChange={setShopping} onInclude={id => setExcluded(ids => ids.filter(i => i !== id))} onAddGear={() => { if (gearForm.current) { gearForm.current.open = true; gearForm.current.scrollIntoView({ behavior: "instant", block: "center" }); gearForm.current.querySelector("input")?.focus(); } }} onSave={savePlan} canSave={Boolean(request.region && request.distanceMiles && request.days)} />
            <PackWeightBreakdown gear={selected} request={request} units={units} onUnitsChange={setUnits} />
            <div className="planner-inventory"><div className="planner-section-heading"><span>{selected.filter(g => packed.includes(g.id)).length} of {selected.length} items packed</span></div>
              <progress aria-label="Packing list progress" max={Math.max(selected.length, 1)} value={selected.filter(g => packed.includes(g.id)).length} />
              <PackInventory gear={selected} packed={packed} units={units} onToggle={togglePacked} onEdit={setEditing} />
              <details className="planner-details"><summary>Choose equipment <span>{selected.length} of {inventory.length} selected</span></summary>
              {inventory.length === 0 ? <p className="planner-empty">Your gear list is empty. Add equipment below or sign in to use your gear locker.</p> : inventory.map(g => <div className="planner-gear-row" key={g.id}>
                <label><input type="checkbox" checked={!excluded.includes(g.id)} onChange={e => { setExcluded(ids => e.target.checked ? ids.filter(id => id !== g.id) : [...ids, g.id]); setExplanation([]); }} /><span><strong>{g.name}{g.qty > 1 ? ` ×${g.qty}` : ""}</strong><small>{g.category} · {g.type}{g.packedSize ? ` · ${g.packedSize}` : ""}</small></span></label><span className="planner-numeric">{gearWeightOz(g) === null ? "Unknown" : formatPackWeight(gearWeightOz(g)!, units, true)}</span><button className="planner-link" onClick={() => setEditing(g)} aria-label={`Edit ${g.name}`}>Edit</button>
              </div>)}
              </details>
            </div>
            {editing && <GearEditor key={editing.id} initial={editing} onSave={saveGear} onCancel={() => setEditing(null)} />}
            <details ref={gearForm} className="planner-details" open={inventory.length === 0}><summary>Add equipment</summary><GearEditor onSave={saveGear} /></details>
            <details className="planner-details" open><summary>Food, water & fuel</summary><label className="planner-check"><input type="checkbox" checked={request.suppliesInGear} onChange={e => setTrip({ suppliesInGear: e.target.checked })} />All starting supplies are already included in my selected gear weights</label>
              {!request.suppliesInGear && <div className="planner-fields"><NumberField label="Food per day (oz)" value={request.foodOzPerDay} max={300} onChange={foodOzPerDay => setTrip({ foodOzPerDay })} /><NumberField label="Starting water carry (liters)" value={request.waterLiters} max={100} onChange={waterLiters => setTrip({ waterLiters })} /><NumberField label="Additional fuel (oz)" value={request.fuelOz} max={1000} onChange={fuelOz => setTrip({ fuelOz })} hint="Enter 0 if none. Include the container in your gear." /></div>}
              <p className="planner-help">Enter your actual planned amounts. Water weight is for your starting carry; refill points need confirmation. Food uses {request.days ?? "your number of"} days.</p>
              {report.missingSupplies.length > 0 && <p className="planner-help">Still needed: {report.missingSupplies.join(", ")}.</p>}
              {report.duplicateSupplies && <p className="planner-alert">You have consumables in your gear and additional supplies here. Check that food, water, and fuel aren’t counted twice.</p>}
            </details>
            <details className="planner-details pack-guide-disclosure" open><summary>Detailed packing guide</summary><PackingGuide gear={selected} request={request} packed={packed} onToggle={togglePacked} units={units} capacityLiters={memory.profile.packCapacityL} /></details>
            {report.overTarget && selected.length > 0 && <div className="planner-trim"><h3>Start your weight review here</h3><p>These are your heaviest carried base items. Review duplicates and lighter options without dropping essential protection.</p><ul>{selected.filter(g => g.type === "Base" && g.weightOz !== null).sort((a,b) => b.weightOz!*b.qty-a.weightOz!*a.qty).slice(0, 3).map(g => <li key={g.id}>{g.name} <span>{formatPackWeight(gearWeightOz(g)!, units)}</span></li>)}</ul></div>}
            <button className="planner-button" onClick={() => setStep(2)}>Review & record <span aria-hidden="true">→</span></button>
          </section>}
          {step === 2 && <section className="planner-stage" aria-labelledby="go-title"><h2 id="go-title" ref={stageHeading} tabIndex={-1}>Ready for your outing.</h2><p>Pack your selected equipment from the bottom up. Keep emergency and on-trail items accessible.</p>
            <div className="planner-packing-progress"><span>{selected.filter(g => packed.includes(g.id)).length} of {selected.length} items checked</span><progress aria-label="Equipment packing progress" max={Math.max(selected.length, 1)} value={selected.filter(g => packed.includes(g.id)).length} /></div>
            <PackingGuide gear={selected} request={request} packed={packed} onToggle={togglePacked} units={units} capacityLiters={memory.profile.packCapacityL} />
            <h3>Before you head out</h3><ul className="planner-prep">{preparationChecks(request).map(check => <li key={check}>{check}</li>)}</ul><a href={REFERENCES.essentials} target="_blank" rel="noopener noreferrer">National Park Service: the Ten Essentials</a>
            <div className="planner-actions planner-go-actions"><button className="planner-button" onClick={savePlan} disabled={!request.region || !request.distanceMiles || !request.days}>{activePlanId ? "Save trip changes" : signedIn ? "Save trip to my account" : "Save trip for this visit"}</button><Link className="planner-button secondary" href={route?.trailId ? `/record/live?type=hike&trail_id=${encodeURIComponent(route.trailId)}` : "/record"}>Open activity recorder</Link></div>
          </section>}
          <details id="trip-details" className="planner-details planner-trip-details" open={!request.region || !request.distanceMiles || !request.days}>
            <summary>Trip details <span>{request.distanceMiles ?? "—"} mi · {request.days ?? "—"} days · {request.region || "Choose a region"}</span></summary>
            {milesPerDay != null && milesPerDay > 0 && <p className="planner-fit">{milesPerDay.toFixed(1)} miles per day{history.usualMilesPerDay ? ` · ${milesPerDay > history.usualMilesPerDay * 1.15 ? "Above" : "Close to or below"} your usual ${history.usualMilesPerDay.toFixed(1)} mi/day.` : " · Add your usual daily mileage in My trip preferences to compare."} Terrain, altitude, and conditions also affect effort.</p>}
            <div className="planner-fields">
              <label>Region<input value={request.region} onChange={e => { setTrip({ region: e.target.value }); setRoute(null); }} maxLength={100} /></label>
              <NumberField label="Target distance (mi)" value={request.distanceMiles} min={0.1} onChange={distanceMiles => { setTrip({ distanceMiles }); setRoute(null); }} />
              <NumberField label="Days" value={request.days} min={1} max={365} step="1" onChange={days => setTrip({ days: days === null ? null : Math.round(days) })} />
              <label>Start date<input type="date" value={request.startDate} onChange={e => setTrip({ startDate: e.target.value })} /></label>
              <NumberField label="Expected overnight low (°F)" value={request.lowTempF} min={-80} max={130} onChange={lowTempF => setTrip({ lowTempF })} hint="Check a forecast for the route’s elevation." />
            </div><button className="planner-button secondary" type="button" disabled={searching || !request.region} onClick={() => void findSources(request)}>Refresh online route search</button>
          </details>
          <details className="planner-details planner-questions"><summary>{followUps.length ? `${followUps.length} details to make this plan yours` : "Your trip details are filled in"}</summary><ul>{followUps.map(q => <li key={q}>{q}</li>)}</ul><p className="planner-help">Update trip details above and My trip preferences alongside the plan.</p></details>
          <div className="planner-ai-answer">
            <LocalOutdoorAiChat onApplyPrompt={(p) => { setPrompt(p); setNotice(`Prompt applied from Eco AI: ${p}`); }} />
            <div className="planner-section-heading"><h3>Think it through with Eco AI</h3>{model.status === "ready" && !aiError && <button className="planner-link" onClick={() => void explain()}>Explain my plan</button>}</div>
            <p className="planner-help">{model.status === "off" || model.status === "error" ? "Turn on Eco AI to get an explanation using this trip, your gear, and past-trip feedback." : model.status === "loading" ? "The browser model is loading. Keep building your plan while it finishes." : model.status === "thinking" ? "Thinking on this device…" : "The local model prioritizes facts and questions from your current plan. Displayed weights and specifications come from the planner’s verified data."}</p>
            {explanation.length > 0 && explainedSignature === aiSignature && <ul className="planner-explanation">{explanation.map(text => <li key={text}>{text}</li>)}</ul>}<p id="planner-ai-error" role="status" className="planner-help">{aiError}</p>
            {aiError && <button type="button" className="planner-button secondary" aria-describedby="planner-ai-error" disabled={model.status === "loading" || model.status === "thinking"} onClick={() => void explain()}>Retry explanation</button>}
          </div>
        </>}
        <p role="status" className="planner-notice">{memoryError || notice}</p>
      </div>
      <aside className="planner-sidebar" aria-label="Your planning context">
        {started && step > 0 && <section className="planner-pack-summary"><h2>Know what you carry.</h2>
            <div className="planner-weight"><div><span>{report.complete ? "Calculated starting pack" : "Known weight so far"}</span><strong>{formatPackWeight(report.loadedLb * 16, units)}</strong></div><dl><div><dt>Base gear</dt><dd>{formatPackWeight(report.baseLb * 16, units)}</dd></div><div><dt>Food, water & fuel</dt><dd>{formatPackWeight(report.suppliesLb * 16, units)}</dd></div><div><dt>Worn separately</dt><dd>{formatPackWeight(report.wornLb * 16, units)}</dd></div></dl></div>
          <div className="planner-summary-actions"><button className="planner-button" onClick={() => setStep(step === 1 ? 2 : 1)}>{step === 1 ? "Review & record" : "Edit packing list"}</button><button className="planner-button secondary" onClick={downloadChecklist}>Download checklist</button><button className="planner-link" onClick={savePlan} disabled={!request.region || !request.distanceMiles || !request.days}>{activePlanId ? "Save trip changes" : "Save trip on this device"}</button></div>
            <p className="planner-fit">{history.comfortablePackLb ? `Your carrying target: ${formatPackWeight(history.comfortablePackLb * 16, units)}. ${report.overTarget ? `Currently ${formatPackWeight((report.loadedLb-history.comfortablePackLb) * 16, units)} over your target.` : report.complete ? "Within your chosen target." : "Add the missing weights before comparing."}` : "What pack weight has felt comfortable on similar trips? Add it in My trip preferences to set a personal target."}</p>
            {report.baseBudgetLb != null && <p className="planner-help">With these supplies, your base-gear budget is {formatPackWeight(Math.max(0, report.baseBudgetLb) * 16, units)}.{report.baseBudgetLb < 0 ? " Supplies alone exceed your target; revise your plan and resupply strategy." : " This is a planning target, not a personal safety limit."} <a href={REFERENCES.weight} target="_blank" rel="noopener noreferrer">Pack-weight guidance</a></p>}
            {report.missingSupplies.length > 0 && <p className="planner-help">Still needed: {report.missingSupplies.join(", ")}.</p>}
            {report.unknown.length > 0 && <p className="planner-alert">Weight missing: {report.unknown.join(", ")}. The total is incomplete.</p>}
          <p className="planner-help">Use the item weights and detailed guide in your packing list to balance the load and keep essentials within reach.</p>

        </section>}

        <section className="planner-memory"><h2>Built around you.</h2><p>{context.userId ? "Using your signed-in account’s equipment and completed hikes." : "Planning as a guest. What you add is kept for this visit only; sign in to keep it on every device."}</p><dl><div><dt>Gear available</dt><dd>{inventory.length} {inventory.length === 1 ? "item" : "items"}</dd></div><div><dt>Recorded hikes</dt><dd>{context.activities.length}</dd></div><div><dt>Trip feedback</dt><dd>{history.completedCount} {history.completedCount === 1 ? "trip" : "trips"}</dd></div></dl>{history.typicalRecordedHike != null && <p className="planner-help">Your typical recorded hike is {history.typicalRecordedHike.toFixed(1)} mi. Add daily-mileage preferences for overnight trips.</p>}<Link className="planner-button secondary" href="/gear">Review my gear</Link>{!context.userId && <p><Link href="/login?next=%2Fplan">Sign in to keep your trips and use account gear & hikes</Link></p>}{memoryLoading && signedIn && <p className="planner-help" role="status">Loading your saved trips…</p>}{memoryError && <p className="planner-alert" role="alert">{memoryError}</p>}</section>
        <details className="planner-details"><summary>My trip preferences</summary><div className="planner-fields one-column">
          <NumberField label="Usual comfortable miles / day" value={memory.profile.usualMilesPerDay} min={0.1} max={100} onChange={usualMilesPerDay => setProfile({ usualMilesPerDay })} />
          <NumberField label="Comfortable loaded pack (lb)" value={memory.profile.comfortablePackLb} min={1} max={150} onChange={comfortablePackLb => setProfile({ comfortablePackLb })} hint={history.basis} />
          <NumberField label="Backpack capacity (liters)" value={memory.profile.packCapacityL} min={1} max={200} onChange={packCapacityL => setProfile({ packCapacityL })} />
          <label>Backpacking experience<select value={memory.profile.experience} onChange={e => setProfile({ experience: e.target.value as PlannerProfile["experience"] })}><option value="new">Getting started</option><option value="some">Some overnight trips</option><option value="experienced">Experienced</option></select></label>
          <label>What matters to you?<textarea rows={3} value={memory.profile.priorities} onChange={e => setProfile({ priorities: e.target.value })} maxLength={500} placeholder="Quieter trails, a warm sleep system…" /></label>
        </div><p className="planner-help">{signedIn ? "Saved to your account." : "Kept for this visit; sign in to keep it."} Your explicit preferences take priority over learned trip feedback.</p></details>
        <details className="planner-local planner-details"><summary>Eco AI</summary><div className="planner-section-heading"><h3>Eco-friendly on-device AI</h3><span className={`planner-model-status ${model.status === "ready" ? "ready" : ""}`}>{model.status === "ready" ? "On device" : model.status === "thinking" ? "Thinking" : model.status === "loading" ? "Loading" : "Off"}</span></div>
          <p>Hyked Eco AI runs on your own device instead of a data center, so each answer uses no cloud servers and no extra data-center energy or cooling water. No separate app to install. The first load downloads Llama 3.2 3B model files into browser storage (~2 GB). A WebGPU-capable Chrome or Edge browser and available device memory are required.</p>
          <p className="planner-help">Your trip and gear context are processed locally. Online lookup sends only the search terms or product URL. The standard planner works without loading AI.</p>
          {model.status === "loading" && <progress aria-label="Local model loading" value={model.progress} max={1} />}
          <p className="planner-model-message" role="status">{model.message}</p>
          {model.status === "off" || model.status === "error" ? <button className="planner-button secondary" onClick={() => void model.load()}>{model.status === "error" ? "Retry Eco AI" : "Turn on Eco AI"}</button> : <button className="planner-link" onClick={model.stop}>{model.status === "loading" ? "Cancel model loading" : model.status === "thinking" ? "Stop AI" : "Turn off Eco AI"}</button>}
        </details>
        <details className="planner-details" open={!started && memory.plans.length > 0}><summary>Saved trips <span>{memory.plans.length}</span></summary>{memory.plans.length === 0 ? <p className="planner-help">Save a trip after preparing your pack. When you return, add feedback here.</p> : memory.plans.map(plan => <div className="planner-saved" key={plan.id}><h4>{plan.route?.name ?? plan.request.region}</h4><p>{plan.route?.distanceMiles ?? plan.request.distanceMiles} mi · {plan.request.days} days{plan.feedback ? " · Completed" : " · Planned"}</p><button className="planner-link" onClick={() => restore(plan)}>Restore trip</button><details><summary>{plan.feedback ? "Review trip feedback" : "How did the trip go?"}</summary><FeedbackForm key={`${plan.id}-${JSON.stringify(plan.feedback)}`} plan={plan} onSave={feedback => { update(m => ({ ...m, plans: m.plans.map(p => p.id === plan.id ? { ...p, feedback } : p) })); setNotice("Trip feedback remembered. Future plans will use it."); }} /></details></div>)}</details>
        <details className="planner-details"><summary>Privacy & memory</summary><p>Only this account’s data is used; it is never shared with other users or outside apps.</p><p>{signedIn ? "Your preferences, saved trips and gear are stored in your Hyked account, protected so only you can read them, and available on every device you sign in on. Nothing is kept on this device." : "As a guest, nothing is written to this device: what you add is held in this tab and cleared when you leave. Sign in to keep it."}</p>{forgetPending ? <div role="group" aria-label="Confirm deleting planning data"><p>{signedIn ? "This deletes your planner preferences and saved trips from your account. Gear and recorded activities stay." : "This clears your preferences, gear additions and saved trips for this visit."}</p><div className="planner-actions"><button className="planner-button secondary" onClick={() => { if (update(() => emptyMemory())) { setActivePlanId(null); setSavedSignature(""); setStarted(false); setExcluded([]); setPacked([]); setShopping([]); setRoute(null); setExplanation([]); model.stop(); setForgetPending(false); setNotice(signedIn ? "Planner preferences and saved trips deleted." : "Planning memory cleared."); } }}>Confirm</button><button className="planner-link" onClick={() => setForgetPending(false)}>Keep my data</button></div></div> : <button className="planner-link" onClick={() => setForgetPending(true)}>{signedIn ? "Delete saved trips and preferences" : "Clear planning memory"}</button>}</details>
        {context.messages.map(message => <p className="planner-alert" key={message}>{message}</p>)}
      </aside>
    </div>
  </div>;
}
