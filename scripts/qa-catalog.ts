/**
 * QA checklist for a built catalog: runs the static app's trail service (src/web/trail-service.ts) and the route
 * builder (src/lib/routing) in Node against the generated public/trail-data files, and prints PASS / FAIL / SKIP
 * for each item of the release checklist. Exit code 1 when anything fails.
 *
 *   npx tsx scripts/qa-catalog.ts [--data public/trail-data]
 *
 * /trail-data/* is served from disk and /api/* from the trail service; anything else (DEM tiles, Wikimedia) goes
 * to the network with a timeout, and checks that need it are skipped when it can't be reached.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const argData = process.argv.indexOf("--data");
const DATA = path.resolve(argData > 0 ? process.argv[argData + 1] : "public/trail-data");
const realFetch = globalThis.fetch;

type Json = Record<string, unknown>;
type Trail = { id: string; name: string; miles?: number | null; region?: string | null; country?: string; park?: string | null; tier?: string | null };

// Relative URLs (as the browser app uses them) resolve against a fake origin.
const ORIGIN = "http://qa.local";
async function local(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = input instanceof Request ? input : new Request(new URL(String(input), ORIGIN), init);
  const url = new URL(req.url);
  if (url.origin === ORIGIN && url.pathname.startsWith("/trail-data/")) {
    try { return new Response(await readFile(path.join(DATA, url.pathname.slice("/trail-data/".length)))); }
    catch { return new Response("", { status: 404 }); }
  }
  if (url.origin === ORIGIN && url.pathname.startsWith("/api/trail-catalog")) return trailService(req, local as typeof fetch);
  if (url.origin === ORIGIN) return Response.json({ error: "Not available in QA." }, { status: 503 });
  return realFetch(req, { signal: AbortSignal.timeout(20_000) });
}
globalThis.fetch = local as typeof fetch;

// Imported after the fetch shim so modules that capture fetch at load time see it.
type Svc = typeof import("../src/web/trail-service");
let trailService: Svc["trailService"];

const api = async (p: string) => {
  const res = await local(`/api/trail-catalog${p}`);
  return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as Json };
};
const search = async (q: string, limit = 10) => api(`?${new URLSearchParams({ q, limit: String(limit) })}`);
const trailsOf = (d: Json) => (d.trails as Trail[] | undefined) ?? [];

const results: { check: string; status: "PASS" | "FAIL" | "SKIP"; detail: string }[] = [];
async function check(name: string, run: () => Promise<string | { skip: string }>) {
  try {
    const out = await run();
    results.push(typeof out === "string" ? { check: name, status: "PASS", detail: out } : { check: name, status: "SKIP", detail: out.skip });
  } catch (error) {
    results.push({ check: name, status: "FAIL", detail: error instanceof Error ? error.message : String(error) });
  }
}
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
const top = (d: Json, n = 3) => trailsOf(d).slice(0, n).map((t) => `${t.name} (${t.park ?? t.region ?? "?"})`).join(" | ") || "no results";

/** Every string anywhere in the value that reads "undefined" or "NaN". */
function badStrings(v: unknown, at = "$"): string[] {
  if (typeof v === "string") return /\bundefined\b|\bNaN\b/.test(v) ? [`${at}: "${v.slice(0, 60)}"`] : [];
  if (typeof v === "number") return Number.isNaN(v) ? [`${at}: NaN`] : [];
  if (Array.isArray(v)) return v.flatMap((x, i) => badStrings(x, `${at}[${i}]`));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => badStrings(x, `${at}.${k}`));
  return [];
}

async function firstMatch(q: string, name: RegExp, place?: RegExp) {
  const { ok, data } = await search(q);
  assert(ok, `search "${q}" failed: ${String(data.error ?? "")}`);
  const first = trailsOf(data)[0];
  assert(first, `search "${q}" returned nothing`);
  assert(name.test(first.name), `first result is ${top(data, 1)}; top 3: ${top(data)}`);
  if (place) assert(place.test(`${first.park ?? ""} ${first.region ?? ""}`), `first result is in ${first.park ?? first.region}, expected ${place}`);
  const total = Number(data.total);
  assert(Number.isInteger(total) && total >= trailsOf(data).length, `count ${data.total} doesn't match ${trailsOf(data).length} results shown`);
  return { first, data, total };
}

async function main() {
  ({ trailService } = await import("../src/web/trail-service"));
  const { buildRoute } = await import("../src/lib/routing");
  const { splitDays } = await import("../src/lib/routing/days");

  let mist: Trail | null = null;
  await check(`search "mist" → Mist Trail (Yosemite)`, async () => {
    const r = await firstMatch("mist", /^mist trail/i, /yosemite|california/i);
    mist = r.first;
    return `${r.first.name} · ${r.total.toLocaleString("en-US")} matches`;
  });
  await check(`search "half dome" → Half Dome Trail`, async () => {
    const r = await firstMatch("half dome", /half dome/i, /yosemite|california/i);
    return `${r.first.name} · ${r.total.toLocaleString("en-US")} matches`;
  });
  await check(`search "angels landing" → Angels Landing (Zion)`, async () => {
    const r = await firstMatch("angels landing", /angels? landing/i, /zion|utah/i);
    return `${r.first.name} · ${r.total.toLocaleString("en-US")} matches`;
  });
  await check(`search "yosemite" top 10 has Mist, Half Dome, Four Mile, Panorama`, async () => {
    const { data } = await search("yosemite", 10);
    const names = trailsOf(data).map((t) => t.name);
    const missing = [/mist trail/i, /half dome/i, /four mile/i, /panorama/i].filter((re) => !names.some((n) => re.test(n)));
    assert(!missing.length, `missing ${missing.map(String).join(", ")}; top 10: ${names.join(" | ")}`);
    return `${Number(data.total).toLocaleString("en-US")} matches; top: ${names.slice(0, 5).join(" | ")}`;
  });

  await check("Mist Trail page: whole trail, tier, no undefined/NaN", async () => {
    assert(mist, "Mist Trail not found by search");
    const { ok, data } = await api(`/${encodeURIComponent(mist.id)}`);
    assert(ok, `detail failed: ${String(data.error ?? "")}`);
    const t = data.trail as Trail & { sources?: unknown[]; sectionCount?: number };
    assert(typeof t.miles === "number" && t.miles >= 2 && t.miles <= 8, `length ${t.miles} mi (expected 2–8, a whole trail)`);
    assert(t.tier === "verified" || t.tier === "mapped", `tier is ${t.tier ?? "missing"}`);
    const bad = badStrings(data);
    assert(!bad.length, `bad values: ${bad.slice(0, 3).join("; ")}`);
    return `${t.miles} mi · ${t.tier}${t.sectionCount ? ` · ${t.sectionCount} sections` : ""} · ${(data.lines as unknown[]).length} line pieces`;
  });

  await check("Mist Trail /features: features by mile", async () => {
    assert(mist, "Mist Trail not found by search");
    const { data } = await api(`/${encodeURIComponent(mist.id)}/features`);
    const list = (data.features as { type: string; name: string; mile: number; offTrailFt: number }[] | undefined) ?? [];
    assert(data.available !== false, "this build has no feature layer");
    assert(list.length > 0, "no features on the trail");
    assert(list.every((f) => Number.isFinite(f.mile) && Number.isFinite(f.offTrailFt)), "a feature without mile/offTrailFt");
    return `${list.length} features: ${list.slice(0, 4).map((f) => `${f.name} @ mi ${f.mile.toFixed(1)}`).join(", ")}`;
  });

  const JMT1 = "jmt-sec-1";
  await check("JMT Section 1 water: feature layer only, real miles", async () => {
    const { ok, data } = await api(`/${JMT1}/water`);
    assert(ok, `water failed: ${String(data.error ?? "")}`);
    const sources = (data.sources as { name: string | null; mile: number; kind: string }[]) ?? [];
    const miles = Number(data.trailMiles);
    assert(/feature layer/i.test(String(data.attribution)), `water not from the feature layer (${String(data.attribution).slice(0, 70)})`);
    const generated = sources.filter((s) => /#\s*\d+/.test(s.name ?? ""));
    assert(!generated.length, `generated names: ${generated.slice(0, 3).map((s) => s.name).join(", ")}`);
    assert(sources.every((s) => Number.isFinite(s.mile) && s.mile >= 0 && s.mile <= miles + 0.5), "a source with a mile outside the trail");
    return `${sources.length} sources over ${miles} mi; longest dry ${String(data.longestDryMiles)} mi`;
  });
  await check("JMT Section 1 towns: real places with distances", async () => {
    const { ok, data } = await api(`/${JMT1}/towns`);
    assert(ok, `towns failed: ${String(data.error ?? "")}`);
    const towns = (data.towns as { name: string; distanceMiles?: number; milesOff?: number }[]) ?? [];
    assert(towns.length > 0, "no towns");
    const fake = towns.filter((t) => /gateway|outpost|resupply|summit camp/i.test(t.name));
    assert(!fake.length, `placeholder-looking towns: ${fake.map((t) => t.name).join(", ")}`);
    const bad = badStrings(towns);
    assert(!bad.length, `bad values: ${bad.slice(0, 3).join("; ")}`);
    return towns.slice(0, 4).map((t) => t.name).join(", ");
  });
  await check("JMT Section 1 elevation: ~4,000 ft low, ~8,600–11,000 ft high", async () => {
    const probe = await realFetch("https://s3.amazonaws.com/elevation-tiles-prod/terrarium/0/0/0.png", { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!probe?.ok) return { skip: "DEM tiles unreachable" };
    const { ok, data } = await api(`/${JMT1}/elevation`);
    assert(ok, `elevation failed: ${String(data.error ?? "")}`);
    const min = Number(data.minFt), max = Number(data.maxFt);
    assert(min >= 3500 && min <= 4500, `min ${min} ft (expected 3,500–4,500)`);
    assert(max >= 8000 && max <= 11500, `max ${max} ft (expected 8,000–11,500)`);
    return `${min.toLocaleString("en-US")}–${max.toLocaleString("en-US")} ft, +${Number(data.gainFt).toLocaleString("en-US")} ft`;
  });

  await check("features in view: Yosemite Valley has water + campsites", async () => {
    const { data } = await api(`/features?bbox=-119.66,37.70,-119.52,37.77`);
    const list = (data.features as { type: string }[] | undefined) ?? [];
    const water = list.filter((f) => ["spring", "drinking_water", "lake", "river", "crossing", "ford"].includes(f.type)).length;
    const camp = list.filter((f) => ["campsite", "camp_pitch", "shelter", "hut"].includes(f.type)).length;
    assert(water > 0 && camp > 0, `${list.length} features: ${water} water, ${camp} camping`);
    return `${list.length} features: ${water} water, ${camp} camping`;
  });

  await check("clusters at zoom 4: count bubbles", async () => {
    const { ok, data } = await api(`/clusters?zoom=4&bbox=-170,15,-50,75`);
    assert(ok, `clusters failed: ${String(data.error ?? "")}`);
    const clusters = (data.clusters as number[][]) ?? [];
    assert(clusters.length > 0, "no clusters");
    assert(clusters.every((c) => c[2] > 0), "an empty cluster");
    return `${clusters.length} bubbles, ${Number(data.total).toLocaleString("en-US")} trails (${Number(data.verified).toLocaleString("en-US")} verified)`;
  });

  await check("route Happy Isles → Tuolumne Meadows: 18–28 mi, water + camps, 2 days", async () => {
    const route = await buildRoute([[-119.5579, 37.7317], [-119.359, 37.8735]]);
    assert(route.miles >= 18 && route.miles <= 28, `${route.miles.toFixed(1)} mi via ${route.trails.map((t) => t.name).join(" → ")}`);
    const water = route.features.filter((f) => ["spring", "drinking_water", "lake", "river", "crossing", "ford"].includes(f.type));
    const camps = route.features.filter((f) => ["campsite", "camp_pitch", "shelter", "hut"].includes(f.type));
    assert(water.length > 0, "no water along the route");
    assert(camps.length > 0, "no campsites along the route");
    const days = splitDays(route.miles, route.features, route.miles / 2);
    assert(days.length === 2, `split into ${days.length} days`);
    return `${route.miles.toFixed(1)} mi via ${route.trails.slice(0, 4).map((t) => t.name).join(" → ")}; ${water.length} water, ${camps.length} camps; night 1 at ${days[0].stop?.name ?? "no campsite"} (mi ${days[0].toMile.toFixed(1)})`;
  });

  // ---- worldwide (skipped when the build has no worldwide trails) ----
  const pointer = JSON.parse(await readFile(path.join(DATA, "current.json"), "utf8")) as { directory: string };
  const manifest = JSON.parse(await readFile(path.join(DATA, pointer.directory, "manifest.json"), "utf8")) as { searchShards?: string[] };
  const world = (manifest.searchShards ?? []).length > 0;
  const worldSearch = (label: string, q: string, name: RegExp, country: string) => check(label, async () => {
    if (!world) return { skip: "no worldwide trails in this build" };
    const { ok, data } = await search(q);
    assert(ok, `search "${q}" failed: ${String(data.error ?? "")}`);
    const hit = trailsOf(data).find((t) => name.test(t.name) && t.country === country);
    assert(hit, `no ${name} in ${country}; top 3: ${top(data)}`);
    return `${hit.name} (${hit.region ?? hit.country}) · ${hit.miles ?? "?"} mi · ${Number(data.total).toLocaleString("en-US")} matches`;
  });
  let whw: Trail | undefined;
  await check(`search "west highland way" → Scotland`, async () => {
    if (!world) return { skip: "no worldwide trails in this build" };
    const { data } = await search("west highland way");
    whw = trailsOf(data).find((t) => /west highland way/i.test(t.name) && t.country === "GB");
    assert(whw, `not found; top 3: ${top(data)}`);
    return `${whw.name} (${whw.region}) · ${whw.miles} mi`;
  });
  await worldSearch(`search "tour du mont blanc" → Alps`, "tour du mont blanc", /tour du mont.?blanc/i, "FR");
  await worldSearch(`search "milford track" → New Zealand`, "milford track", /milford track/i, "NZ");
  await worldSearch(`search "kungsleden" → Sweden`, "kungsleden", /kungsleden/i, "SE");
  await worldSearch(`search "adlerweg tirol" → Austria (country index)`, "adlerweg tirol", /adlerweg/i, "AT");
  await check("West Highland Way page: whole trail with a line", async () => {
    if (!world) return { skip: "no worldwide trails in this build" };
    assert(whw, "West Highland Way not found by search");
    const { ok, data } = await api(`/${encodeURIComponent(whw.id)}`);
    assert(ok, `detail failed: ${String(data.error ?? "")}`);
    const t = data.trail as Trail;
    assert(typeof t.miles === "number" && t.miles >= 80 && t.miles <= 110, `length ${t.miles} mi (expected 80–110, the whole trail)`);
    assert((data.lines as unknown[]).length > 0, "no line");
    const bad = badStrings(data);
    assert(!bad.length, `bad values: ${bad.slice(0, 3).join("; ")}`);
    const feats = await api(`/${encodeURIComponent(whw.id)}/features`);
    const list = (feats.data.features as unknown[] | undefined) ?? [];
    return `${t.miles} mi · ${t.tier} · ${(data.lines as unknown[]).length} line pieces · ${list.length} features along it`;
  });
  await check("sledding near Innsbruck", async () => {
    if (!world) return { skip: "no worldwide trails in this build" };
    const { data } = await api(`?${new URLSearchParams({ activity: "sled", bbox: "10.5,46.8,12.5,47.6", limit: "20" })}`);
    assert(trailsOf(data).length > 0, `no sled runs (${String(data.error ?? "")})`);
    return `${Number(data.total).toLocaleString("en-US")} sled runs; ${top(data)}`;
  });
  await check("clusters worldwide: every section, paddling included", async () => {
    if (!world) return { skip: "no worldwide trails in this build" };
    const out: string[] = [];
    for (const activity of ["hike", "bike", "horse", "ski", "paddle"]) {
      const { data } = await api(`/clusters?zoom=3&activity=${activity}`);
      assert(Number(data.total) > 0, `no ${activity} trails worldwide`);
      out.push(`${activity} ${Number(data.total).toLocaleString("en-US")}`);
    }
    return out.join(" · ");
  });

  const width = Math.max(...results.map((r) => r.check.length));
  console.log(`\nQA against ${DATA}\n`);
  for (const r of results) console.log(`${r.status.padEnd(4)}  ${r.check.padEnd(width)}  ${r.detail}`);
  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log(`\n${results.length - failed} of ${results.length} passed or skipped; ${failed} failed.`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
