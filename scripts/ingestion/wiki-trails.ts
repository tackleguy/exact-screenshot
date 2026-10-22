/**
 * Wikidata trails in the United States and Canada (instances of trail, Q628179, and its subclasses), plus any
 * item an OSM route relation links with its `wikidata` tag. For each: names, coordinates, linked OSM relation,
 * the English Wikipedia lead paragraph and the item's main Commons image with licence and author.
 * Output: data/sources/wiki-trails.json.gz. Responses are cached in .cache/wiki.
 * npx tsx scripts/ingestion/wiki-trails.ts   (run after osm-routes.ts to include relation-linked items)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import path from "node:path";

const root = process.cwd();
const cacheDir = path.join(root, ".cache/wiki");
const UA = { "User-Agent": "Hyked/1.0 trail catalog (https://github.com/tackleguy/health)" };

async function cached<T>(key: string, make: () => Promise<T>): Promise<T> {
  const file = path.join(cacheDir, `${createHash("sha256").update(key).digest("hex").slice(0, 20)}.json.gz`);
  try { return JSON.parse(gunzipSync(await readFile(file)).toString()); } catch { /* fetch */ }
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const value = await make();
      await writeFile(file, gzipSync(JSON.stringify(value)));
      return value;
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
    }
  }
  throw lastError;
}

type Binding = Record<string, { value: string } | undefined>;
const sparql = (query: string) => cached(`sparql:${query}`, async () => {
  const r = await fetch(`https://query.wikidata.org/sparql?${new URLSearchParams({ query })}`, { headers: { ...UA, Accept: "application/sparql-results+json" }, signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw new Error(`SPARQL ${r.status}`);
  return ((await r.json()) as { results: { bindings: Binding[] } }).results.bindings;
});

const FIELDS = `?item ?itemLabel ?coord ?article ?image ?osm (GROUP_CONCAT(DISTINCT ?alt; separator="|") AS ?alts)`;
const OPTIONALS = `
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/> }
  OPTIONAL { ?item wdt:P18 ?image }
  OPTIONAL { ?item wdt:P402 ?osm }
  OPTIONAL { ?item skos:altLabel ?alt FILTER(LANG(?alt) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }`;
const GROUP = `GROUP BY ?item ?itemLabel ?coord ?article ?image ?osm`;

interface WikiTrail {
  qid: string; label: string; aliases: string[]; coord: [number, number] | null; osmRelation: number | null;
  wikipedia: { title: string; url: string; extract: string } | null;
  image: { file: string; url: string; pageUrl: string; license: string | null; licenseUrl: string | null; artist: string | null } | null;
}

const plain = (html: string | undefined) => (html ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || null;

async function main() {
  await mkdir(cacheDir, { recursive: true });
  const rows: Binding[] = [...await sparql(`SELECT ${FIELDS} WHERE { VALUES ?c { wd:Q30 wd:Q16 } ?item wdt:P31/wdt:P279* wd:Q628179; wdt:P17 ?c . ${OPTIONALS} } ${GROUP}`)];
  // Items that OSM route relations point at, whatever their Wikidata class.
  try {
    const routes = JSON.parse(gunzipSync(await readFile(path.join(root, "data/sources/osm-routes.json.gz"))).toString()).routes as { tags: Record<string, string> }[];
    const have = new Set(rows.map((r) => r.item!.value.split("/").pop()));
    const extra = [...new Set(routes.map((r) => r.tags.wikidata).filter((q): q is string => /^Q\d+$/.test(q ?? "") && !have.has(q)))];
    for (let i = 0; i < extra.length; i += 200) rows.push(...await sparql(`SELECT ${FIELDS} WHERE { VALUES ?item { ${extra.slice(i, i + 200).map((q) => `wd:${q}`).join(" ")} } ${OPTIONALS} } ${GROUP}`));
    console.log(`${extra.length} extra items linked from OSM relations.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    console.log("No osm-routes.json.gz yet; relation-linked items skipped.");
  }

  const byQid = new Map<string, WikiTrail>();
  for (const b of rows) {
    const qid = b.item!.value.split("/").pop()!;
    const t = byQid.get(qid) ?? { qid, label: b.itemLabel?.value ?? qid, aliases: [], coord: null, osmRelation: null, wikipedia: null, image: null };
    const m = b.coord?.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
    if (m && !t.coord) t.coord = [Number(m[1]), Number(m[2])];
    if (b.osm && !t.osmRelation) t.osmRelation = Number(b.osm.value) || null;
    for (const a of (b.alts?.value ?? "").split("|")) if (a && !t.aliases.includes(a)) t.aliases.push(a);
    if (b.article && !t.wikipedia) t.wikipedia = { title: decodeURIComponent(b.article.value.split("/wiki/")[1]).replace(/_/g, " "), url: b.article.value, extract: "" };
    if (b.image && !t.image) t.image = { file: decodeURIComponent(b.image.value.split("Special:FilePath/")[1] ?? "").replace(/_/g, " "), url: "", pageUrl: "", license: null, licenseUrl: null, artist: null };
    byQid.set(qid, t);
  }
  const trails = [...byQid.values()].filter((t) => !/^Q\d+$/.test(t.label));
  console.log(`${trails.length} Wikidata trails; ${trails.filter((t) => t.wikipedia).length} with English Wikipedia articles; ${trails.filter((t) => t.image).length} with an image.`);

  // Wikipedia lead paragraphs, a few at a time.
  const withArticle = trails.filter((t) => t.wikipedia);
  for (let i = 0; i < withArticle.length; i += 4) {
    await Promise.all(withArticle.slice(i, i + 4).map(async (t) => {
      const summary = await cached(`summary:${t.wikipedia!.title}`, async () => {
        const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.wikipedia!.title.replace(/ /g, "_"))}`, { headers: UA, signal: AbortSignal.timeout(30_000) });
        if (r.status === 404) return { extract: "" };
        if (!r.ok) throw new Error(`summary ${r.status}`);
        return (await r.json()) as { extract?: string; type?: string };
      });
      t.wikipedia!.extract = (summary as { type?: string }).type === "disambiguation" ? "" : (summary.extract ?? "");
    }));
    if (i % 400 === 0) console.log(`  summaries ${i}/${withArticle.length}`);
  }

  // Commons licence and author for each image, 50 files per request.
  const withImage = trails.filter((t) => t.image?.file);
  for (let i = 0; i < withImage.length; i += 50) {
    const group = withImage.slice(i, i + 50);
    const info = await cached(`commons:${group.map((t) => t.image!.file).join("|")}`, async () => {
      const r = await fetch(`https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ action: "query", format: "json", prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: "1280", titles: group.map((t) => `File:${t.image!.file}`).join("|") })}`, { headers: UA, signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new Error(`commons ${r.status}`);
      return (await r.json()) as { query?: { normalized?: { from: string; to: string }[]; pages?: Record<string, { title: string; imageinfo?: { thumburl?: string; url: string; descriptionurl: string; extmetadata?: Record<string, { value?: string }> }[] }> } };
    });
    const norm = new Map((info.query?.normalized ?? []).map((n) => [n.from, n.to]));
    const pages = new Map(Object.values(info.query?.pages ?? {}).map((p) => [p.title, p]));
    for (const t of group) {
      const title = `File:${t.image!.file}`;
      const page = pages.get(norm.get(title) ?? title);
      const ii = page?.imageinfo?.[0];
      if (!ii) { t.image = null; continue; }
      const meta = ii.extmetadata ?? {};
      t.image = { file: t.image!.file, url: ii.thumburl ?? ii.url, pageUrl: ii.descriptionurl, license: plain(meta.LicenseShortName?.value), licenseUrl: meta.LicenseUrl?.value ?? null, artist: plain(meta.Artist?.value) };
    }
  }

  await writeFile(path.join(root, "data/sources/wiki-trails.json.gz"), gzipSync(JSON.stringify({ retrievedAt: new Date().toISOString(), license: "Wikidata CC0; Wikipedia text CC BY-SA 4.0; images per their Commons licence", trails })));
  console.log(`Wrote ${trails.length} trails (${trails.filter((t) => t.wikipedia?.extract).length} with a lead paragraph, ${trails.filter((t) => t.image?.url).length} with a licensed image).`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
