/**
 * Wikidata trails in the United States and Canada (instances of trail, Q628179, and its subclasses), plus any
 * item an OSM route relation links with its `wikidata` tag. For each: names, coordinates, linked OSM relation,
 * the English Wikipedia lead paragraph and the item's main Commons image with licence and author.
 * Output: data/sources/wiki-trails.json.gz. Responses are cached in .cache/wiki.
 * npx tsx pipeline/steps/wiki.ts   (run after extract-osm.py so relation-linked items are included)
 *
 * With --world (after extract-world.py): the items that worldwide route relations link, with the same fields,
 * written to data/sources/wiki-world.json.gz for world.ts.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import path from "node:path";
import { readOsmRegion } from "./osm-trails";

const root = process.cwd();
const cacheDir = path.join(root, ".cache/wiki");
const UA = { "User-Agent": "Hyked/1.0 trail catalog (https://github.com/tackleguy/health)" };

async function cached<T>(key: string, make: () => Promise<T>): Promise<T> {
  const file = path.join(cacheDir, `${createHash("sha256").update(key).digest("hex").slice(0, 20)}.json.gz`);
  try { return JSON.parse(gunzipSync(await readFile(file)).toString()); } catch { /* fetch */ }
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const value = await make();
      await writeFile(file, gzipSync(JSON.stringify(value)));
      return value;
    } catch (error) {
      lastError = error;
      // Rate limits (429) and timeouts: back off longer each time (5 s … ~10 min).
      await new Promise((r) => setTimeout(r, 5000 * 2 ** attempt));
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

// English first; worldwide items often have only a local-language label.
const LABEL_LANGUAGES = process.argv.includes("--world") ? "en,mul,de,fr,es,it,nl,pt,pl,cs,sk,sl,hr,sv,nb,da,fi,ja,zh,ko,ru,el,tr" : "en";
const FIELDS = `?item ?itemLabel ?coord ?article ?image ?osm (GROUP_CONCAT(DISTINCT ?alt; separator="|") AS ?alts)`;
const OPTIONALS = `
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/> }
  OPTIONAL { ?item wdt:P18 ?image }
  OPTIONAL { ?item wdt:P402 ?osm }
  OPTIONAL { ?item skos:altLabel ?alt FILTER(LANG(?alt) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${LABEL_LANGUAGES}". }`;
const GROUP = `GROUP BY ?item ?itemLabel ?coord ?article ?image ?osm`;

interface WikiTrail {
  qid: string; label: string; aliases: string[]; coord: [number, number] | null; osmRelation: number | null;
  wikipedia: { title: string; url: string; extract: string } | null;
  image: { file: string; url: string; pageUrl: string; license: string | null; licenseUrl: string | null; artist: string | null } | null;
}

const plain = (html: string | undefined) => (html ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || null;

/** Wikidata items OSM route relations point at (their wikidata tag), from every region file in `dir`. */
async function linkedItems(dir: string) {
  const linked = new Set<string>();
  try {
    for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json.gz"))) {
      const data = await readOsmRegion(path.join(dir, file), ["relations"]);
      for (const r of Object.values(data.relations)) if (/^Q\d+$/.test(r.tags.wikidata ?? "")) linked.add(r.tags.wikidata);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return linked;
}

async function main() {
  await mkdir(cacheDir, { recursive: true });
  if (process.argv.includes("--world")) {
    await collect([], await linkedItems(path.join(root, ".cache/world-pbf")), "data/sources/wiki-world.json.gz");
    return;
  }
  const rows: Binding[] = [...await sparql(`SELECT ${FIELDS} WHERE { VALUES ?c { wd:Q30 wd:Q16 } ?item wdt:P31/wdt:P279* wd:Q628179; wdt:P17 ?c . ${OPTIONALS} } ${GROUP}`)];
  await collect(rows, await linkedItems(path.join(root, ".cache/osm-pbf")), "data/sources/wiki-trails.json.gz");
}

/** Fills in linked items, Wikipedia lead paragraphs and Commons licences, and writes `out`. */
async function collect(rows: Binding[], linked: Set<string>, out: string) {
  const have = new Set(rows.map((r) => r.item!.value.split("/").pop()));
  const extra = [...linked].filter((q) => !have.has(q));
  for (let i = 0; i < extra.length; i += 200) rows.push(...await sparql(`SELECT ${FIELDS} WHERE { VALUES ?item { ${extra.slice(i, i + 200).map((q) => `wd:${q}`).join(" ")} } ${OPTIONALS} } ${GROUP}`));
  console.log(`${extra.length} extra items linked from OSM relations.`);

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

  // Wikipedia lead paragraphs, 20 articles per request (the batch API; one request per article gets rate-limited).
  const withArticle = trails.filter((t) => t.wikipedia);
  for (let i = 0; i < withArticle.length; i += 20) {
    const group = withArticle.slice(i, i + 20);
    const data = await cached(`extracts:${group.map((t) => t.wikipedia!.title).join("|")}`, async () => {
      const r = await fetch(`https://en.wikipedia.org/w/api.php?${new URLSearchParams({ action: "query", format: "json", formatversion: "2", prop: "extracts|pageprops", ppprop: "disambiguation", exintro: "1", explaintext: "1", exlimit: "20", redirects: "1", titles: group.map((t) => t.wikipedia!.title).join("|") })}`, { headers: UA, signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new Error(`extracts ${r.status}`);
      return (await r.json()) as { query?: { normalized?: { from: string; to: string }[]; redirects?: { from: string; to: string }[]; pages?: { title: string; extract?: string; pageprops?: { disambiguation?: string } }[] } };
    });
    const rename = new Map([...(data.query?.normalized ?? []), ...(data.query?.redirects ?? [])].map((n) => [n.from, n.to]));
    const pages = new Map((data.query?.pages ?? []).map((p) => [p.title, p]));
    for (const t of group) {
      let title = t.wikipedia!.title;
      for (let hop = 0; hop < 3 && rename.has(title); hop++) title = rename.get(title)!;
      const page = pages.get(title);
      // The lead paragraph: the first paragraph of the plain-text intro.
      t.wikipedia!.extract = page && !page.pageprops?.disambiguation ? (page.extract ?? "").split("\n").find((p) => p.trim().length > 40)?.trim() ?? "" : "";
    }
    if (i % 1000 === 0) console.log(`  lead paragraphs ${i}/${withArticle.length}`);
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

  await writeFile(path.join(root, out), gzipSync(JSON.stringify({ retrievedAt: new Date().toISOString(), license: "Wikidata CC0; Wikipedia text CC BY-SA 4.0; images per their Commons licence", trails })));
  console.log(`Wrote ${trails.length} trails (${trails.filter((t) => t.wikipedia?.extract).length} with a lead paragraph, ${trails.filter((t) => t.image?.url).length} with a licensed image).`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
