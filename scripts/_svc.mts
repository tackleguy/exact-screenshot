import { readFile } from "node:fs/promises";
import path from "node:path";
import { trailService } from "../src/web/trail-service";
const fetcher = (async (input: string | URL | Request) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://local");
  if (!url.pathname.startsWith("/trail-data/")) return fetch(input as RequestInfo);
  try { return new Response(await readFile(path.join("public", url.pathname))); } catch { return new Response("", { status: 404 }); }
}) as typeof fetch;
for (const q of process.argv.slice(2)) {
  const r = await trailService(new Request(`http://local/api/trail-catalog?${q}`), fetcher);
  const d = await r.json(); console.log(q, "→", d.total, (d.trails ?? []).slice(0, 6).map((t: { name: string; miles: number; region: string }) => `${t.name} (${t.region}, ${t.miles} mi)`).join(" | "));
}
