import { createClient } from "@/lib/supabase/client";
import { apiTarget } from "./api-target";
import { isTrailServicePath, trailService } from "./trail-service";
import { fetchTrailWeather } from "@/lib/weather/forecast";

export const apiOrigin = (import.meta.env.VITE_HYKED_API_URL ?? "").replace(/\/+$/, "");

async function accountActivities(request: Request): Promise<Response> {
  const client = createClient();
  if (!client) return Response.json({ error: "Account saving is not connected." }, { status: 503 });
  const { data: identity } = await client.auth.getUser();
  if (!identity.user) return Response.json({ error: "Sign in to save activities." }, { status: 401 });
  if (request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (
      !body ||
      !["hike", "run", "bike", "ski"].includes(body.activity_type) ||
      !Number.isFinite(body.distance_m) ||
      body.distance_m < 0 ||
      !Number.isFinite(body.duration_sec) ||
      body.duration_sec < 0
    ) {
      return Response.json({ error: "Check the activity type, distance and duration." }, { status: 400 });
    }
    const { data, error } = await client
      .from("activities")
      .insert({
        user_id: identity.user.id,
        status: "completed",
        activity_type: body.activity_type,
        title: body.title,
        distance_m: body.distance_m,
        duration_sec: body.duration_sec,
        elevation_gain_ft: body.elevation_gain_ft,
        route_geojson: body.route_geojson,
        started_at: body.started_at,
        ended_at: body.ended_at,
        trail_id: body.trail_id ?? null,
        ski_area_id: body.ski_area_id ?? null,
        ski_area_name: body.ski_area_name ?? null,
        notes: body.notes ?? null,
      })
      .select("*")
      .single();
    return Response.json(error ? { error: error.message } : { activity: data }, { status: error ? 400 : 201 });
  }
  if (request.method === "GET") {
    const { data, error } = await client
      .from("activities")
      .select("*, trail:trails(*, park:parks(*))")
      .eq("user_id", identity.user.id)
      .eq("status", "completed")
      .order("started_at", { ascending: false })
      .limit(50);
    return Response.json(error ? { error: error.message } : { activities: data ?? [] }, { status: error ? 400 : 200 });
  }
  return Response.json({ error: "This action is not supported." }, { status: 405 });
}

export function installApiBridge() {
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const target = apiTarget(url, window.location.origin, apiOrigin);
    if (target === null) return original(input, init);

    const request = new Request(input instanceof Request ? input : new URL(url, window.location.origin), init);
    const reqUrl = new URL(request.url);

    // 1. Account Activities
    if (reqUrl.pathname === "/api/activities") return accountActivities(request);

    // 2. Weather Forecast (Always available worldwide via NWS / Open-Meteo!)
    if (reqUrl.pathname === "/api/weather/forecast") {
      const lat = Number(reqUrl.searchParams.get("lat"));
      const lng = Number(reqUrl.searchParams.get("lng"));
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        try {
          const forecast = await fetchTrailWeather(lat, lng);
          return Response.json({ forecast });
        } catch {
          return Response.json({ error: "Forecast could not be loaded." }, { status: 502 });
        }
      }
      return Response.json({ error: "Invalid coordinates." }, { status: 400 });
    }

    // 3. Trip Packet Generator (Always available for planning!)
    if (reqUrl.pathname === "/api/trips/packet" && request.method === "POST") {
      const body = (await request.clone().json().catch(() => null)) as Record<string, unknown> | null;
      const trailId = String(body?.trailId ?? "");
      const format = String(body?.format ?? "html");
      const detailRes = await trailService(new Request(`https://example.com/api/trail-catalog/${encodeURIComponent(trailId)}`), original);
      const detailData = detailRes.ok ? await detailRes.json() : null;
      const t = detailData?.trail;
      const trailName = t?.name || "Trail Trip";

      if (format === "html") {
        const pack = (body?.pack as Array<Record<string, unknown>>) ?? [];
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${trailName} - Field Guide & Packet</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1.5rem; color: #1e293b; line-height: 1.6; }
    h1 { color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem; margin-bottom: 1rem; }
    .badge { display: inline-block; background: #0f766e; color: #fff; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.875rem; font-weight: 600; margin-bottom: 1rem; }
    .box { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 1.25rem; margin: 1.5rem 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; }
    .stat-label { font-size: 0.75rem; text-transform: uppercase; color: #64748b; font-weight: bold; }
    .stat-val { font-size: 1.25rem; font-weight: bold; color: #0f172a; }
    ul { padding-left: 1.25rem; }
    li { margin-bottom: 0.35rem; }
    footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e2e8f0; font-size: 0.85rem; color: #64748b; }
  </style>
</head>
<body>
  <div class="badge">Hyked Field Packet</div>
  <h1>${trailName}</h1>
  <div class="box">
    <div class="grid">
      <div><div class="stat-label">Distance</div><div class="stat-val">${t?.miles ? t.miles + " mi" : "Summit / Route"}</div></div>
      <div><div class="stat-label">Region</div><div class="stat-val">${t?.region ?? "High Country"}</div></div>
      <div><div class="stat-label">Difficulty</div><div class="stat-val" style="text-transform: capitalize;">${t?.difficulty ?? "Moderate"}</div></div>
      <div><div class="stat-label">Season</div><div class="stat-val">${t?.season ?? "Summer / Fall"}</div></div>
    </div>
  </div>
  <h2>Field Notes & Access</h2>
  <p>${t?.note ?? "Confirm trail regulations, weather windows, and water availability before setting out. Always carry essential navigation and emergency gear."}</p>
  <h2>Custom Gear & Packing List</h2>
  ${
    pack.length > 0
      ? `<ul>${pack.map((item) => `<li><strong>${item.name}</strong> (Qty: ${item.quantity ?? 1}${item.weightOz ? `, ${item.weightOz} oz` : ""}${item.consumable ? " · Consumable" : ""})</li>`).join("")}</ul>`
      : "<p>Standard 10 Essentials kit: navigation, headlamp, sun protection, first aid, knife, fire starter, shelter, extra food, extra water, extra clothes.</p>"
  }
  <footer>
    Generated by Hyked Outdoor Platform · Always check current land manager advisories and practice Leave No Trace.
  </footer>
</body>
</html>`;
        return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
    }

    // 4. Trail Service (Catalog, Peaks, Thru-Hikes, Sections, Elevation, Water, Towns, GPX)
    if (!target && isTrailServicePath(reqUrl.pathname)) return trailService(request, original);
    if (!target) return Response.json({ error: "Live trail services are not connected yet." }, { status: 503 });

    const headers = new Headers(request.headers);
    return original(new Request(target, request), { headers });
  };

  // Intercept anchor clicks for GPX downloads
  document.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;
      const target = apiTarget(anchor.href, window.location.origin, apiOrigin);
      if (target) {
        anchor.href = target;
      } else if (target === "" && isTrailServicePath(new URL(anchor.href).pathname)) {
        event.preventDefault();
        void trailService(new Request(anchor.href), original).then(async (response) => {
          if (!response.ok) {
            const data = await response.json();
            window.alert(data.error);
            return;
          }
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const download = document.createElement("a");
          download.href = url;
          const disposition = response.headers.get("Content-Disposition") || "";
          const match = /filename="([^"]+)"/.exec(disposition);
          download.download = match ? match[1] : "trail.gpx";
          document.body.appendChild(download);
          download.click();
          download.remove();
          setTimeout(() => URL.revokeObjectURL(url), 30_000);
        });
      } else if (target === "") {
        event.preventDefault();
        window.alert("Live trail services are not connected yet.");
      }
    },
    true,
  );
}