import { StrictMode, useEffect, useMemo, useState, type ReactNode } from "react";
import { useUnits } from "@/lib/units";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import Link from "./compat/link";
import { AppShell } from "@/components/nav/AppShell";
import { GuestSaveBanner } from "@/components/nav/GuestSaveBanner";
import { HomePromotion } from "@/components/home/HomePromotion";
import { TrailExplorer } from "@/components/explore/TrailExplorer";
import { PersonalTrailPage } from "@/components/route-builder/PersonalTrailPage";
import { OsmTrailRedirect } from "./OsmTrailRedirect";
import { CatalogTrailDetail } from "@/components/trails/CatalogTrailDetail";
import { CatalogPresentation, type CatalogResult } from "./CatalogPresentation";
import { CommunityTrails } from "./CommunityTrails";
import { GearPageClient } from "@/components/gear/GearPageClient";
import { LocalGear } from "@/components/gear/LocalGear";
import { PlannerStart } from "@/components/assistant/PlannerStart";
import { AuthCallback } from "@/components/auth/AuthCallback";
import { rowToGear } from "@/lib/account/planner-cloud";
import { TrailDatabase } from "@/components/pack-trails/TrailDatabase";
import { SkiMapClient } from "@/components/ski/SkiMapClient";
import { SkiAreasPage } from "@/components/ski/SkiAreasPage";
import { SkiAreaDetailPage } from "@/components/ski/SkiAreaDetailPage";
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
import { RouteMeta, trailPageMeta, usePageMeta } from "./seo";
import { DataSources } from "@/components/about/DataSources";
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
/** Without a search or filter, the catalog opens on trails near the visitor (western U.S. if location is off). */
const WEST: { lat: number; lng: number; fallback: true } = { lat: 38.5, lng: -119.6, fallback: true };
function Catalog() {
  const { search } = useLocation();
  const needsOrigin = !["q", "collection", "lat", "bbox", "region", "country", "kind", "resort", "page"].some((k) => new URLSearchParams(search).has(k));
  const [origin, setOrigin] = useState<{ lat: number; lng: number; fallback?: true } | null>(null);
  const [state, setState] = useState<{ result?: CatalogResult; map?: CatalogMapResult; error?: string; for?: string }>({});
  useEffect(() => {
    if (!needsOrigin) return;
    let settled = false;
    const finish = (o: { lat: number; lng: number; fallback?: true }) => { if (!settled) { settled = true; setOrigin(o); } };
    const timer = setTimeout(() => finish(WEST), 4000);
    if (!("geolocation" in navigator)) finish(WEST);
    else navigator.geolocation.getCurrentPosition((p) => finish({ lat: p.coords.latitude, lng: p.coords.longitude }), () => finish(WEST), { timeout: 4000, maximumAge: 600_000 });
    return () => clearTimeout(timer);
  }, [needsOrigin]);
  const query = useMemo(() => {
    const params = new URLSearchParams(search);
    if (!params.has("limit")) params.set("limit", "24");
    if (needsOrigin && origin) { params.set("lat", origin.lat.toFixed(3)); params.set("lng", origin.lng.toFixed(3)); params.set("radiusKm", "50"); }
    return params.toString();
  }, [search, needsOrigin, origin]);
  const waiting = needsOrigin && !origin;
  useEffect(() => {
    if (waiting) return;
    const controller = new AbortController();
    Promise.all([
      fetch(`/api/trail-catalog?${query}`, { signal: controller.signal }).then(async res => { const data = await res.json(); if (!res.ok) throw new Error(data.error); return data as CatalogResult; }),
      fetch(`/api/trail-catalog/map?${query}`, { signal: controller.signal }).then(res => res.ok ? res.json() : undefined).catch(() => undefined),
    ]).then(([result, map]) => { if (!controller.signal.aborted) setState({ result, map, for: query }); }).catch(error => { if (!controller.signal.aborted) setState({ error: error.message, for: query }); });
    return () => controller.abort();
  }, [query, waiting]);
  if (state.for === query && state.error) return <Status title="Trail catalog unavailable">{state.error}</Status>;
  if (waiting || state.for !== query || !state.result) return <Status title={waiting ? "Finding trails near you…" : "Loading trails…"} />;
  return <>
    {needsOrigin && origin?.fallback && <p className="catalog-location-note" role="status">Showing trails in the western U.S. Allow location in your browser to see trails near you.</p>}
    <CatalogPresentation key={query} params={new URLSearchParams(query)} result={state.result} mapData={state.map ?? null} />
  </>;
}
function TrailCatalogPage() {
  const { search } = useLocation();
  return new URLSearchParams(search).get("collection") === "community" ? <CommunityTrails /> : <Catalog />;
}
function OsmTrailRoute() { const { id } = useParams(); return <OsmTrailRedirect key={id} id={id ?? ""} />; }
function TrailDetail() {
  const { id = "" } = useParams();
  // Results are kept with the id they belong to, so navigating between trails never shows the previous one.
  const [loaded, setLoaded] = useState<{ id: string; trail?: CatalogTrail; lines?: [number, number][][]; manifest?: CatalogManifest; error?: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`/api/trail-catalog/${encodeURIComponent(id)}`, { signal: controller.signal }).then(async res => { const data = await res.json(); if (!res.ok) throw new Error(data.error); return data; }),
      fetch("/api/trail-catalog?limit=1", { signal: controller.signal }).then(res => res.json()),
    ]).then(([detail, catalog]) => { if (!controller.signal.aborted) setLoaded({ id, ...detail, manifest: catalog.manifest }); })
      .catch(error => { if (!controller.signal.aborted) setLoaded({ id, error: error.message }); });
    return () => controller.abort();
  }, [id]);
  const state = loaded?.id === id ? loaded : null;
  usePageMeta(state?.trail ? trailPageMeta(state.trail) : null);
  if (state?.error) return <Status title="Trail unavailable">{state.error}</Status>;
  if (!state?.trail || !state.manifest) return <Status title="Loading trail…" />;
  // Merged or duplicate ids open their trail; show its own address.
  if (state.trail.id !== id) return <Navigate to={`/explore/trails/${encodeURIComponent(state.trail.id)}`} replace />;
  return <CatalogTrailDetail trail={state.trail} lines={state.lines ?? []} manifest={state.manifest} />;
}
function MapPage({ workspace = false }: { workspace?: boolean }) {
  const { search } = useLocation(); const params = new URLSearchParams(search);
  if (params.get("collection") === "community") return <CommunityTrails />;
  const candidate = params.get("activity");
  const activity: CatalogActivity = candidate && (CATALOG_ACTIVITIES as readonly string[]).includes(candidate) ? candidate as CatalogActivity : "hike";
  const lat = params.has("lat") ? Number(params.get("lat")) : NaN; const lng = params.has("lng") ? Number(params.get("lng")) : NaN;
  const zoom = params.has("z") ? Number(params.get("z")) : NaN;
  // "Build a route from here": ?routeFrom=<lat>,<lng>&routeFromName=<name> opens the route builder with that start.
  const [fromLat, fromLng] = (params.get("routeFrom") ?? "").split(",").map(Number);
  const routeFrom = Number.isFinite(fromLat) && Number.isFinite(fromLng) && Math.abs(fromLat) <= 85 && Math.abs(fromLng) <= 180 && params.get("routeFrom") ? { point: [fromLng, fromLat] as [number, number], name: (params.get("routeFromName") ?? "").slice(0, 120) || "Trail start" } : null;
  const center: [number, number] | null = Number.isFinite(lat) && lat >= -85 && lat <= 85 && Number.isFinite(lng) && lng >= -180 && lng <= 180 ? [lng, lat] : routeFrom?.point ?? null;
  return <TrailExplorer workspace={workspace} start={{ activity, trail: params.get("trail"), center, zoom: Number.isFinite(zoom) && zoom >= 1 && zoom <= 20 ? zoom : routeFrom ? 13 : null, routeFrom }} />;
}
function PersonalTrailRoute({ shared = false }: { shared?: boolean }) {
  const { id, token } = useParams();
  return shared ? <PersonalTrailPage key={token} token={token ?? ""} /> : <PersonalTrailPage key={id} id={id ?? ""} />;
}
/** Explore links keep their query (e.g. ?routeFrom=… from a trail page) when they redirect to the map. */
function ExploreRedirect() { const { search } = useLocation(); return <Navigate to={`/explore/trails${search}`} replace />; }
function Gear() { const { user, loading } = useAccount(); if (loading) return <Status title="Loading gear…" />; return user ? <div className="fieldbook-page"><GearPageClient userId={user.id} /></div> : <LocalGear />; }
const GUEST_PLANNER: PlannerContext = { userId: null, gear: [], activities: [], routes: [...REFERENCE_ROUTES], messages: [] };
function Planner() {
  const { user, loading } = useAccount(); const { search } = useLocation(); const params = new URLSearchParams(search);
  const [context, setContext] = useState<PlannerContext>({ userId: null, gear: [], activities: [], routes: [...REFERENCE_ROUTES], messages: [] });
  useEffect(() => {
    const client = createClient(); let active = true;
    if (!user || !client) return;
    Promise.all([client.from("gear_items").select("*").eq("user_id", user.id).limit(500), client.from("activities").select("*").eq("user_id", user.id).eq("status", "completed").eq("activity_type", "hike").limit(40), client.from("user_trails").select("*").eq("user_id", user.id).limit(100)]).then(([gear, history, trails]) => {
      if (!active) return;
      setContext({ userId: user.id, gear: (gear.data ?? []).map(rowToGear), activities: (history.data ?? []).map(a => ({ id: a.id, title: a.title, miles: Number(a.distance_m) / 1609.344, hours: Number(a.duration_sec) / 3600, date: a.started_at })), routes: [...REFERENCE_ROUTES, ...(trails.data ?? []).map(t => ({ id: `custom:${t.id}`, name: t.name, region: t.location, distanceMiles: Number(t.distance), elevationFt: Number(t.elevation), difficulty: t.difficulty, sourceUrl: null, sourceLabel: "Your custom route", note: "Confirm current conditions and access before travel." }))], messages: gear.error ? ["Your account gear could not be loaded."] : [] });
    }); return () => { active = false; };
  }, [user?.id]);
  if (loading) return <Status title="Loading your trips…" />;
  // Guests (or a signed-out session) plan with the shared reference routes only.
  const effective = user && context.userId === user.id ? context : GUEST_PLANNER;
  return <PlannerStart context={effective} initialRegion={params.get("region") ?? ""} initialPrompt={params.get("prompt") ?? ""} routeParam={params.get("personalTrail") ?? params.get("route")} />;
}
function SavedTrails() { const { user } = useAccount(); return user ? <div className="fieldbook-page"><TrailDatabase userId={user.id} /></div> : null; }
function SkiAreaDetail() { const { slug } = useParams(); return <SkiAreaDetailPage slug={slug ?? ""} />; }
function Recorder() { const { search } = useLocation(); const params = new URLSearchParams(search); const type = params.get("type"); const activity: ActivityType = type === "run" || type === "bike" || type === "ski" ? type : "hike"; return <GpsRecorder activityType={activity} title={params.get("name")?.slice(0, 120) || `${activity.charAt(0).toUpperCase()}${activity.slice(1)}`} trailId={params.get("trail_id") ?? undefined} skiAreaId={params.get("resort_id") ?? undefined} skiAreaName={params.get("resort_name") ?? undefined} autoStart={Boolean(params.get("trail_id") || params.get("resort_id"))} />; }
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
/** Activity log: recorded hikes for signed-in people; guests learn where their recordings will appear. */
function ActivityLog() {
  const { user, loading } = useAccount();
  usePageMeta({ title: "Activity log | Hyked", description: "Your recorded hikes, runs, rides and ski days." });
  if (loading) return <Status title="Loading your activity…" />;
  if (user) return <ActivityFeed />;
  return <Status title="Your activity log"><p>Hikes you record with Hyked are listed here once you sign in, on every device.</p><Link className="btn-primary" href="/login?next=%2Factivity">Sign in</Link> <Link className="btn-ghost" href="/record">Record a hike</Link></Status>;
}
function Home() {
  const { user } = useAccount();
  return <><HomePromotion signedIn={Boolean(user)} />{user && <ActivityFeed />}</>;
}
function BackendPage() { const location = useLocation(); return <Status title="This page is unavailable right now">{apiOrigin ? <a className="btn-primary" href={`${apiOrigin}${location.pathname}${location.search}`}>Open this page</a> : "Please try again later."}</Status>; }
function App() {
  const { user } = useAccount();
  const { pathname } = useLocation();
  // Pages redraw when the units setting changes (every formatter reads it).
  const units = useUnits();
  return <><RouteMeta pathname={pathname} /><img src={mountainUrl} alt="" aria-hidden className="mountain-backdrop" /><GuestSaveBanner signedIn={Boolean(user)} /><AppShell><Routes key={units}>
    <Route path="/" element={<Home />} /><Route path="/explore" element={<ExploreRedirect />} /><Route path="/my/trails/:id" element={<PersonalTrailRoute />} /><Route path="/shared/trails/:token" element={<PersonalTrailRoute shared />} /><Route path="/trails" element={<Navigate to="/explore/trails" replace />} />
    <Route path="/explore/trails" element={<MapPage workspace />} /><Route path="/explore/trails/catalog" element={<TrailCatalogPage />} /><Route path="/explore/trails/:id" element={<TrailDetail />} /><Route path="/trails/:id" element={<TrailDetail />} /><Route path="/trail/osm/:id" element={<OsmTrailRoute />} /><Route path="/trail/:id" element={<TrailDetail />} /><Route path="/map" element={<MapPage />} /><Route path="/explore/ski" element={<SkiMapClient />} /><Route path="/ski-areas" element={<SkiAreasPage />} /><Route path="/ski-areas/:slug" element={<SkiAreaDetail />} />
    <Route path="/gear" element={<Gear />} /><Route path="/plan" element={<Planner />} /><Route path="/login" element={<LoginPage />} /><Route path="/signup" element={<SignupPage />} /><Route path="/auth/callback" element={<AuthCallback />} />
    <Route path="/record" element={<RecordPage />} /><Route path="/record/manual" element={<RequireAccount><ManualRecordPage /></RequireAccount>} /><Route path="/record/live" element={<RequireAccount><Recorder /></RequireAccount>} />
    <Route path="/pack-trails" element={<RequireAccount><SavedTrails /></RequireAccount>} /><Route path="/you" element={<RequireAccount><ActivityFeed profile /></RequireAccount>} /><Route path="/activity" element={<ActivityLog />} /><Route path="/about/data" element={<DataSources />} /><Route path="/activities/:id" element={<RequireAccount><ActivityDetail /></RequireAccount>} />
    <Route path="/parks/:id" element={<BackendPage />} /><Route path="/admin/*" element={<BackendPage />} /><Route path="*" element={<Status title="Page not found"><Link className="btn-ghost" href="/">Return to Hyked</Link></Status>} />
  </Routes></AppShell></>;
}
installApiBridge();
const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>);