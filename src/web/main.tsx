import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import Link from "./compat/link";
import { AppShell } from "@/components/nav/AppShell";
import { DeployBanner } from "@/components/nav/DeployBanner";
import { HomeSearch } from "@/components/home/HomeSearch";
import { TrailExplorer } from "@/components/explore/TrailExplorer";
import { CatalogTrailDetail } from "@/components/trails/CatalogTrailDetail";
import { CatalogPresentation, type CatalogResult } from "./CatalogPresentation";
import { GearPageClient } from "@/components/gear/GearPageClient";
import { LocalGear } from "@/components/gear/LocalGear";
import { TripPlanner } from "@/components/assistant/TripPlanner";
import { TrailDatabase } from "@/components/pack-trails/TrailDatabase";
import { SkiMapClient } from "@/components/ski/SkiMapClient";
import { GpsRecorder } from "@/components/gps/GpsRecorder";
import { ActivityListRow } from "@/components/activities/ActivityListRow";
import { ActivityStats } from "@/components/activities/ActivityStats";
import { RouteMiniMap } from "@/components/activities/RouteMiniMap";
import LoginPage from "@/app/login/page";
import SignupPage from "@/app/signup/page";
import RecordPage from "@/app/record/page";
import ManualRecordPage from "@/app/record/manual/page";
import { createClient } from "@/lib/supabase/client";
import { REFERENCE_ROUTES } from "@/lib/assistant/catalog";
import type { PlannerContext } from "@/lib/assistant/types";
import type { Activity, ActivityType } from "@/lib/types";
import type { CatalogManifest, CatalogTrail, CatalogMapResult } from "@/lib/trail-catalog/types";
import { CATALOG_ACTIVITIES, type CatalogActivity } from "@/lib/trail-catalog/activity";
import mountainNight from "@/assets/mountain-night.jpg";
import { apiOrigin, installApiBridge } from "./api";
import { useAccount } from "./session";
import "@/app/globals.css";
import "./web.css";
const mountainUrl = typeof mountainNight === "string" ? mountainNight : mountainNight.src;

function Status({ title, children }: { title: string; children?: ReactNode }) { return <section className="fieldbook-page"><h1>{title}</h1><p role="status">{children}</p></section>; }
function RequireAccount({ children }: { children: ReactNode }) {
  const { user, loading } = useAccount(); const location = useLocation();
  if (loading) return <Status title="Loading your account…" />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return children;
}
function Catalog() {
  const { search } = useLocation();
  const [state, setState] = useState<{ result?: CatalogResult; map?: CatalogMapResult; error?: string }>({});
  useEffect(() => {
    const controller = new AbortController(); setState({});
    const params = new URLSearchParams(search); if (!params.has("limit")) params.set("limit", "4");
    Promise.all([
      fetch(`/api/trail-catalog?${params}`, { signal: controller.signal }).then(async res => { const data = await res.json(); if (!res.ok) throw new Error(data.error); return data as CatalogResult; }),
      fetch(`/api/trail-catalog/map?${params}`, { signal: controller.signal }).then(res => res.ok ? res.json() : undefined).catch(() => undefined),
    ]).then(([result, map]) => { if (!controller.signal.aborted) setState({ result, map }); }).catch(error => { if (!controller.signal.aborted) setState({ error: error.message }); });
    return () => controller.abort();
  }, [search]);
  if (state.error) return <Status title="Trail catalog unavailable">{state.error}</Status>;
  if (!state.result) return <Status title="Loading trails…" />;
  return <CatalogPresentation key={search} params={new URLSearchParams(search)} result={state.result} mapData={state.map ?? null} />;
}
function TrailDetail() {
  const { id } = useParams();
  const [state, setState] = useState<{ trail?: CatalogTrail; lines?: [number, number][][]; manifest?: CatalogManifest; error?: string }>({});
  useEffect(() => {
    const controller = new AbortController(); setState({});
    Promise.all([fetch(`/api/trail-catalog/${encodeURIComponent(id ?? "")}`, { signal: controller.signal }).then(async res => { const data = await res.json(); if (!res.ok) throw new Error(data.error); return data; }), fetch("/api/trail-catalog?limit=1", { signal: controller.signal }).then(res => res.json())]).then(([detail, catalog]) => { if (!controller.signal.aborted) setState({ ...detail, manifest: catalog.manifest }); }).catch(error => { if (!controller.signal.aborted) setState({ error: error.message }); });
    return () => controller.abort();
  }, [id]);
  if (state.error) return <Status title="Trail unavailable">{state.error}</Status>;
  if (!state.trail || !state.manifest) return <Status title="Loading trail…" />;
  return <CatalogTrailDetail trail={state.trail} lines={state.lines ?? []} manifest={state.manifest} />;
}
function MapPage() {
  const { search } = useLocation(); const params = new URLSearchParams(search);
  const candidate = params.get("activity");
  const activity: CatalogActivity = candidate && (CATALOG_ACTIVITIES as readonly string[]).includes(candidate) ? candidate as CatalogActivity : "hike";
  const lat = params.has("lat") ? Number(params.get("lat")) : NaN; const lng = params.has("lng") ? Number(params.get("lng")) : NaN;
  const zoom = params.has("z") ? Number(params.get("z")) : NaN;
  return <TrailExplorer start={{ activity, trail: params.get("trail"), center: Number.isFinite(lat) && lat >= -85 && lat <= 85 && Number.isFinite(lng) && lng >= -180 && lng <= 180 ? [lng, lat] : null, zoom: Number.isFinite(zoom) && zoom >= 1 && zoom <= 20 ? zoom : null }} />;
}
function Gear() { const { user, loading } = useAccount(); if (loading) return <Status title="Loading gear…" />; return user ? <div className="fieldbook-page"><GearPageClient userId={user.id} /></div> : <LocalGear />; }
function Planner() {
  const { user, loading } = useAccount(); const { search } = useLocation(); const params = new URLSearchParams(search);
  const [context, setContext] = useState<PlannerContext>({ userId: null, gear: [], activities: [], routes: [...REFERENCE_ROUTES], messages: [] });
  useEffect(() => {
    const client = createClient(); let active = true;
    if (!user || !client) { setContext({ userId: null, gear: [], activities: [], routes: [...REFERENCE_ROUTES], messages: [] }); return; }
    Promise.all([client.from("gear_items").select("*").eq("user_id", user.id).limit(500), client.from("activities").select("*").eq("user_id", user.id).eq("status", "completed").eq("activity_type", "hike").limit(40), client.from("user_trails").select("*").eq("user_id", user.id).limit(100)]).then(([gear, history, trails]) => {
      if (!active) return;
      setContext({ userId: user.id, gear: (gear.data ?? []).map(g => ({ ...g.product_details, id: String(g.id), name: String(g.name), category: g.category, type: g.type, qty: Math.max(1, Number(g.qty) || 1), weightOz: Number(g.weight) > 0 ? Number(g.weight) : null, price: Number(g.price), packedSize: g.product_details?.packedSize ?? null, sourceUrl: g.link ?? null })), activities: (history.data ?? []).map(a => ({ id: a.id, title: a.title, miles: Number(a.distance_m) / 1609.344, hours: Number(a.duration_sec) / 3600, date: a.started_at })), routes: [...REFERENCE_ROUTES, ...(trails.data ?? []).map(t => ({ id: `custom:${t.id}`, name: t.name, region: t.location, distanceMiles: Number(t.distance), elevationFt: Number(t.elevation), difficulty: t.difficulty, sourceUrl: null, sourceLabel: "Your custom route", note: "Confirm current conditions and access before travel." }))], messages: gear.error ? ["Your account gear could not be loaded."] : [] });
    }); return () => { active = false; };
  }, [user?.id]);
  if (loading) return <Status title="Loading your trips…" />;
  return <TripPlanner context={context} initialRegion={params.get("region") ?? ""} initialPrompt={params.get("prompt") ?? ""} />;
}
function SavedTrails() { const { user } = useAccount(); return user ? <div className="fieldbook-page"><TrailDatabase userId={user.id} /></div> : null; }
function Recorder() { const { search } = useLocation(); const params = new URLSearchParams(search); const type = params.get("type"); const activity: ActivityType = type === "run" || type === "bike" || type === "ski" ? type : "hike"; return <GpsRecorder activityType={activity} title={`${activity.charAt(0).toUpperCase()}${activity.slice(1)}`} trailId={params.get("trail_id") ?? undefined} skiAreaId={params.get("resort_id") ?? undefined} skiAreaName={params.get("resort_name") ?? undefined} autoStart={Boolean(params.get("trail_id") || params.get("resort_id"))} />; }
function ActivityFeed({ profile = false }: { profile?: boolean }) {
  const { user } = useAccount(); const [activities, setActivities] = useState<Activity[]>([]); const [error, setError] = useState("");
  useEffect(() => { const client = createClient(); if (!user || !client) return; let active = true; client.from("activities").select("*, trail:trails(*, park:parks(*))").eq("user_id", user.id).eq("status", "completed").order("started_at", { ascending: false }).limit(50).then(({ data, error }) => { if (active) { setActivities((data ?? []) as Activity[]); setError(error?.message ?? ""); } }); return () => { active = false; }; }, [user?.id]);
  return <section className="fieldbook-page"><h1>{profile ? user?.user_metadata?.first_name || "Your profile" : "Your outings"}</h1>{profile && <p>{user?.email}</p>}<Link className="btn-ghost" href="/record">Record an activity</Link>{error && <p role="alert">{error}</p>}<div className="mt-6">{activities.map(activity => <ActivityListRow key={activity.id} activity={activity} />)}{activities.length === 0 && !error && <p>No activities yet.</p>}</div></section>;
}
function ActivityDetail() {
  const { id } = useParams(); const [activity, setActivity] = useState<Activity | null>(null); const [error, setError] = useState("");
  useEffect(() => { const client = createClient(); if (!client) return; let active = true; client.from("activities").select("*, trail:trails(*, park:parks(*))").eq("id", id).single().then(({ data, error }) => { if (active) { setActivity(data as Activity | null); setError(error?.message ?? ""); } }); return () => { active = false; }; }, [id]);
  if (error) return <Status title="Activity unavailable">{error}</Status>;
  if (!activity) return <Status title="Loading activity…" />;
  return <section className="fieldbook-page"><Link className="btn-ghost" href="/you">← Your activities</Link><h1>{activity.title}</h1><RouteMiniMap route={activity.route_geojson} className="h-80 w-full" /><ActivityStats distanceM={Number(activity.distance_m)} durationSec={Number(activity.duration_sec)} elevationGainFt={Number(activity.elevation_gain_ft)} /><p>{activity.notes}</p></section>;
}
function Home() {
  const { user } = useAccount();
  return <><section className="mountain-hero"><img src={mountainUrl} alt="Alpine mountains at blue hour" className="mountain-hero-image" /><div className="mountain-hero-content"><p className="section-label">Trails · Gear · Adventure</p><h1>Hyked</h1><p className="mountain-hero-intro">Find your next trail. Pack for the journey.</p><HomeSearch /><div className="mountain-hero-links"><Link href="/explore/trails">Explore trails <span aria-hidden>↗</span></Link><Link href="/plan">Plan a trip <span aria-hidden>↗</span></Link></div></div></section>{user ? <ActivityFeed /> : <section className="fieldbook-page"><h2>Make room for the outdoors.</h2><div className="fieldbook-trail-paths"><Link href="/explore/trails"><h3>Find a trail</h3></Link><Link href="/plan"><h3>Plan your trip</h3></Link><Link href="/gear"><h3>Prepare your gear</h3></Link></div></section>}</>;
}
function BackendPage() { const location = useLocation(); return <Status title="This page needs live trail services">{apiOrigin ? <a className="btn-primary" href={`${apiOrigin}${location.pathname}${location.search}`}>Open this page</a> : "Live trail services are not connected yet."}</Status>; }
function App() {
  return <><img src={mountainUrl} alt="" aria-hidden className="mountain-backdrop" /><AppShell notice={<DeployBanner />}><Routes>
    <Route path="/" element={<Home />} /><Route path="/explore" element={<Navigate to="/explore/trails" replace />} /><Route path="/trails" element={<Navigate to="/explore/trails" replace />} />
    <Route path="/explore/trails" element={<Catalog />} /><Route path="/explore/trails/:id" element={<TrailDetail />} /><Route path="/trails/:id" element={<TrailDetail />} /><Route path="/map" element={<MapPage />} /><Route path="/explore/ski" element={<SkiMapClient />} />
    <Route path="/gear" element={<Gear />} /><Route path="/plan" element={<Planner />} /><Route path="/login" element={<LoginPage />} /><Route path="/signup" element={<SignupPage />} />
    <Route path="/record" element={<RecordPage />} /><Route path="/record/manual" element={<RequireAccount><ManualRecordPage /></RequireAccount>} /><Route path="/record/live" element={<RequireAccount><Recorder /></RequireAccount>} />
    <Route path="/pack-trails" element={<RequireAccount><SavedTrails /></RequireAccount>} /><Route path="/you" element={<RequireAccount><ActivityFeed profile /></RequireAccount>} /><Route path="/activities/:id" element={<RequireAccount><ActivityDetail /></RequireAccount>} />
    <Route path="/parks/:id" element={<BackendPage />} /><Route path="/admin/*" element={<BackendPage />} /><Route path="*" element={<Status title="Page not found"><Link className="btn-ghost" href="/">Return to Hyked</Link></Status>} />
  </Routes></AppShell></>;
}
installApiBridge();
const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>);