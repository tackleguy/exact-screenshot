import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { trailService } from "./trail-service";

test("trailService rejects SPA HTML fallback responses without caching corrupt entries", async () => {
  let htmlMode = true;
  const manifest = {
    directory: "snapshot-9999999999999",
    generatedAt: "2026-01-01T00:00:00Z",
    total: 1,
    publicTotal: 1,
    indexSha256: "abc",
    countries: { US: 1 },
    regions: [],
    sources: [],
    notes: [],
    cells: ["31_63"],
  };
  const sampleTrail = {
    id: "nps-test-1",
    name: "Mist Trail",
    country: "US",
    region: "California",
    park: "Yosemite National Park",
    manager: "National Park Service",
    latitude: 37.732,
    longitude: -119.558,
    miles: 5.4,
    difficulty: "Hard",
    dogs: false,
    kind: "segment",
    source: "nps",
    sourceType: "FEDERAL_AGENCY",
    sourceUrl: "https://mapservices.nps.gov/example",
    geometryShard: "60_127",
    tier: "verified",
    qualityScore: 95,
  };

  const mockFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (htmlMode) {
      return new Response("<!doctype html><html><body>SPA fallback</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.endsWith("/trail-data/current.json")) {
      return Response.json({ directory: manifest.directory });
    }
    if (url.endsWith(`/trail-data/${manifest.directory}/manifest.json`)) {
      return Response.json(manifest);
    }
    if (url.endsWith(`/trail-data/${manifest.directory}/overview.json.gz`)) {
      return new Response(gzipSync(JSON.stringify([sampleTrail])), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  const first = await trailService(new Request("https://site.example/api/trail-catalog?limit=5"), mockFetch);
  assert.equal(first.status, 503);
  const firstJson = (await first.json()) as { error?: string };
  assert.ok(firstJson.error && !firstJson.error.includes("Unexpected token"));

  htmlMode = false;
  const second = await trailService(new Request("https://site.example/api/trail-catalog?limit=5"), mockFetch);
  assert.equal(second.status, 200);
  const secondJson = (await second.json()) as { trails: { id: string }[] };
  assert.ok(secondJson.trails.some((t) => t.id === "nps-test-1"));
});
