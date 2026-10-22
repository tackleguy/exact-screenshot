/**
 * Trail search: every query word must match a word of the trail's name, other names or place (park, forest,
 * managing unit, state, Wikipedia title), exactly, as a prefix ("mist" → "Mist Trail") or within one or two
 * typos ("angles landing"). Name matches outrank place matches, and the quality score breaks ties so whole,
 * well-documented trails come first.
 */
export interface SearchEntry {
  name: string[];
  alt: string[];
  place: string[];
  /** Normalized full name, for whole-phrase matches. */
  phrase: string;
}

export const normalizeText = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’'`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const words = (s: string | null | undefined) => (s ? normalizeText(s).split(" ").filter(Boolean) : []);

export function searchEntry(t: { name: string; altNames?: string[]; park?: string; forest?: string; blmArea?: string; manager?: string | null; region?: string | null; wiki?: { title?: string }; partOfRoute?: { name: string } }): SearchEntry {
  return {
    name: words(t.name),
    alt: [...new Set([...(t.altNames ?? []), t.wiki?.title ?? ""].flatMap(words))],
    place: [...new Set([t.park, t.forest, t.blmArea, t.manager, t.region, t.partOfRoute?.name].flatMap(words))],
    phrase: normalizeText(t.name),
  };
}

/** Edit distance with transpositions, stopping early past `max`. */
function editDistance(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [], prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

function wordScore(term: string, tokens: string[]) {
  let best = 0;
  for (const tok of tokens) {
    if (tok === term) return 1;
    if (term.length >= 2 && tok.startsWith(term)) best = Math.max(best, 0.85);
    else if (term.length >= 4) {
      const max = term.length >= 8 ? 2 : 1;
      if (editDistance(term, tok.slice(0, Math.max(term.length, Math.min(tok.length, term.length + max))), max) <= max) best = Math.max(best, 0.6);
    }
  }
  return best;
}

/** 0 when some query word matches nothing; otherwise higher is a better match (roughly 0–4). */
export function matchScore(query: string, e: SearchEntry) {
  const terms = words(query);
  if (!terms.length) return 0;
  let total = 0;
  for (const term of terms) {
    const s = Math.max(wordScore(term, e.name), 0.9 * wordScore(term, e.alt), 0.5 * wordScore(term, e.place));
    if (!s) return 0;
    total += s;
  }
  const q = normalizeText(query);
  let bonus = 0;
  if (e.phrase === q) bonus = 2;
  else if (e.phrase.startsWith(q)) bonus = 1.2;
  else if (` ${e.phrase} `.includes(` ${q} `)) bonus = 0.8;
  // Prefer names that are mostly the query, not long names that merely contain it.
  const coverage = terms.length / Math.max(terms.length, e.name.filter((w) => !/^(trail|the|loop|path)$/.test(w)).length);
  return total / terms.length + bonus + 0.5 * coverage;
}

/** True when every query word names the trail's place (park, forest, managing unit), e.g. "yosemite". */
export function placeMatch(query: string, e: SearchEntry) {
  const terms = words(query);
  return terms.length > 0 && terms.every((t) => e.place.some((w) => w === t || (t.length >= 3 && w.startsWith(t))));
}

/**
 * Search rank: text match first, quality score as the tie-breaker within a band. A query that names a park or
 * forest ranks that place's trails by quality, so "Yosemite" lists its best trails before a 0.5-mile "Yosemite
 * Trail" elsewhere.
 */
export const searchRank = (match: number, qualityScore = 0, place = false) =>
  Math.max(match * 100 + qualityScore, place ? 200 + 2 * qualityScore : 0);
