import Link from "next/link";
import type { CatalogManifest, CatalogTrail, CatalogMapResult } from "@/lib/trail-catalog/types";
import { parseCatalogFilters } from "@/lib/trail-catalog/search";
import { headlineCount, countryName, displayMiles, trailPlace, trailSacScale } from "@/lib/trail-catalog/types";
import { trailDifficulty } from "@/lib/trail-difficulty";
import { QUALITY_STATUS_LABELS } from "@/lib/trail-catalog/quality";
import { CatalogMap } from "@/components/trails/CatalogMap";
import { NavIcon } from "@/components/nav/NavIcon";
import { SectionIcon } from "@/components/explore/SectionIcon";
import { CATALOG_ACTIVITY_LABELS, TRAIL_SECTIONS, sectionOf } from "@/lib/trail-catalog/activity";
import "@/components/trails/catalog.css";

/** Same colours as the map's difficulty legend (kept here so the list doesn't load the map code). */
const DIFFICULTY_COLORS: Record<string, string> = { e: "#2f9e5b", m: "#2f7fd8", h: "#d8452f", x: "#1d1d1d" };
const ROUTE_SHAPES: Record<string, string> = { loop: "Loop", "out-and-back": "Out & back", "point-to-point": "Point to point", segment: "Trail segment" };
const LENGTHS = [["", "Any length"], ["-3", "Under 3 mi"], ["3-8", "3 – 8 mi"], ["8-15", "8 – 15 mi"], ["15-", "Over 15 mi"]] as const;

export interface CatalogResult { trails: CatalogTrail[]; total: number; page: number; pages: number; limit: number; manifest: CatalogManifest; /** Name/place matches when more matched than were ranked and loaded. */ queryMatches?: number }
export function CatalogPresentation({ params, result, mapData }: { params: URLSearchParams; result: CatalogResult; mapData: CatalogMapResult | null }) {
  const filters = parseCatalogFilters(params);
  const preview = filters.limit === undefined && (!filters.page || filters.page === 1);
  const { trails, total, page, pages, limit, manifest } = result;
  const activity = filters.activity ?? "hike";
  const filterSummary = [
    filters.bbox && "Map area",
    filters.collection === "14ers" && "⛰️ 14ers (14,000+ ft Peaks)",
    filters.collection === "8000m" && "🏔️ The 14 Eight-Thousanders",
    filters.collection === "7summits" && "Seven Summits",
    filters.collection === "thru-hikes" && "Through-Hikes (All Together)",
    filters.collection === "thru-sections" && "Through-Hike Sections",
    filters.country === "intl"
      ? "International"
      : filters.country && countryName(filters.country),
    filters.kind === "route" && !filters.collection && "Through-hikes",
    filters.kind === "segment" && !filters.collection && "Sections only",
    activity !== "hike" && activity !== "all" && CATALOG_ACTIVITY_LABELS[activity],
    filters.uniqueNames && "Unique names",
    filters.includeFragments && "Partial segments",
    filters.region,
    filters.minMiles !== undefined && filters.maxMiles !== undefined
      ? `${filters.minMiles}–${filters.maxMiles} mi`
      : filters.minMiles !== undefined ? `${filters.minMiles}+ mi` : filters.maxMiles !== undefined && `Under ${filters.maxMiles} mi`,
    filters.difficulty && filters.difficulty[0].toUpperCase() + filters.difficulty.slice(1),
    filters.routeType && ROUTE_SHAPES[filters.routeType],
    filters.dogFriendly && "Dogs allowed",
    filters.verified && "Verified only",
    filters.sort === "short" && "Shortest first",
    filters.sort === "long" && "Longest first",
  ]
    .filter(Boolean)
    .join(" · ");
  const hasFilters = Boolean(filters.q || filterSummary);
  const allParams = new URLSearchParams(params);
  allParams.set("limit", "24");
  allParams.delete("page");
  function pageHref(n: number) {
    const next = new URLSearchParams(params);
    next.set("page", String(n));
    return `/explore/trails/catalog?${next}`;
  }

  // One count for the whole page: "Showing the first 24 of 1,284 trails near you" when the list is capped.
  const first = (page - 1) * limit + 1, last = Math.min(page * limit, total);
  const where = `${params.has("lat") && !params.get("q") ? " near you" : ""}${params.get("region") ? ` in ${params.get("region")}` : ""}`;
  const resultSummary = !total
    ? "No matching trails"
    : result.queryMatches
      ? `Showing the ${trails.length.toLocaleString("en-US")} best of ${result.queryMatches.toLocaleString("en-US")} trails matching “${params.get("q")}”`
      : `${total > trails.length ? `Showing ${first === 1 ? `the first ${last.toLocaleString("en-US")}` : `${first.toLocaleString("en-US")}–${last.toLocaleString("en-US")}`} of ` : ""}${total.toLocaleString("en-US")} ${total === 1 ? "trail" : "trails"}${where}`;

  return (
    <div className="catalog-shell">
      <header className="catalog-heading">
        <h1>Find your next trail.</h1>
        <p>{headlineCount(manifest).toLocaleString("en-US")} trails in {Object.keys(manifest.countries ?? {}).length || 2} countries.</p>
        <Link className="catalog-mobile-plan" href="/plan">
          Have a trip in mind? Plan it
        </Link>
      </header>
      <nav className="catalog-sections" aria-label="Trail sections">
        {TRAIL_SECTIONS.map((section) => {
          const next = new URLSearchParams(params);
          next.delete("page");
          next.delete("includeWinter");
          next.set("activity", section.activity);
          return (
            <Link key={section.key} href={`/explore/trails/catalog?${next}`} className="catalog-section" aria-current={sectionOf(activity === "all" ? "hike" : activity).key === section.key ? "page" : undefined}>
              <SectionIcon section={section.key} size={20} />
              {section.label}
            </Link>
          );
        })}
      </nav>
      <form className="catalog-filters" action="/explore/trails/catalog">
        {!preview && <input type="hidden" name="limit" value={limit} />}
        {filters.bbox && <input type="hidden" name="bbox" value={filters.bbox.join(",")} />}
        {activity !== "all" && (
          <input type="hidden" name="activity" value={activity} />
        )}
        {(activity === "ski" || activity === "sled") && <input type="hidden" name="includeWinter" value="true" />}
        <div className="catalog-search-bar">
          <label className="catalog-query">
            <span className="sr-only">Search trails</span>
            <NavIcon name="explore" />
            <input
              type="search"
              name="q"
              maxLength={180}
              defaultValue={params.get("q") ?? ""}
              placeholder="Search trails or places"
            />
          </label>
          <button className="catalog-button" type="submit">
            Search
          </button>
        </div>
        <details className="catalog-filter-disclosure">
          <summary>
            <span className="catalog-filter-label">
              <NavIcon name="filters" />
              Filters
              <NavIcon name="chevron" />
            </span>
            {filterSummary && <span className="catalog-active-filters">{filterSummary}</span>}
          </summary>
          <div className="catalog-filter-panel">
            <div className="catalog-filter-fields">
              <label>
                Country
                <select name="country" defaultValue={params.get("country") ?? ""}>
                  <option value="">All countries</option>
                  <option value="US">United States</option>
                  <option value="CA">Canada</option>
                  <option value="intl">Outside the U.S. and Canada</option>
                  {Object.entries(manifest.countries ?? {})
                    .filter(([code]) => code !== "US" && code !== "CA" && /^[A-Z]{2}$/.test(code))
                    .sort((a, b) => countryName(a[0]).localeCompare(countryName(b[0])))
                    .map(([code]) => <option key={code} value={code}>{countryName(code)}</option>)}
                </select>
              </label>
              <label>
                Type
                <select name="kind" defaultValue={params.get("kind") ?? ""}>
                  <option value="">Routes & trails</option>
                  <option value="route">Through-hikes only</option>
                  <option value="segment">Mapped trails only</option>
                </select>
              </label>
              <label>
                State or province
                <select name="region" defaultValue={params.get("region") ?? ""}>
                  <option value="">All regions</option>
                  {manifest.regions.map((r) => (
                    <option key={`${r.country}-${r.name}`} value={r.name}>
                      {r.name} · {r.country}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Length
                <select name="length" defaultValue={params.get("length") ?? ""}>
                  {LENGTHS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>
                Difficulty
                <select name="difficulty" defaultValue={params.get("difficulty") ?? ""}>
                  <option value="">Any difficulty</option>
                  <option value="easy">Easy</option>
                  <option value="moderate">Moderate</option>
                  <option value="hard">Hard</option>
                  <option value="expert">Expert</option>
                </select>
              </label>
              <label>
                Route shape
                <select name="routeType" defaultValue={params.get("routeType") ?? ""}>
                  <option value="">Any shape</option>
                  {Object.entries(ROUTE_SHAPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>
                Sort
                <select name="sort" defaultValue={params.get("sort") ?? ""}>
                  <option value="">Best match</option>
                  <option value="short">Shortest first</option>
                  <option value="long">Longest first</option>
                </select>
              </label>
              <label className="catalog-checkbox">
                <input type="checkbox" name="dogFriendly" value="true" defaultChecked={params.get("dogFriendly") === "true"} />
                Dogs allowed
              </label>
              <label className="catalog-checkbox">
                <input type="checkbox" name="verified" value="true" defaultChecked={params.get("verified") === "true"} />
                Verified by a park or agency
              </label>
              <label className="catalog-checkbox">
                <input
                  type="checkbox"
                  name="includeFragments"
                  value="true"
                  defaultChecked={params.get("includeFragments") === "true"}
                />
                Include partial, unnamed, connector and sidewalk segments
              </label>
            </div>
            <div className="catalog-collections">
              <span className="catalog-muted">Collections</span>
              <Link href="/explore/trails/catalog?collection=thru-hikes">Through-hikes</Link>
              <Link href="/explore/trails/catalog?collection=thru-sections">Through-hike sections</Link>
              <Link href="/explore/trails/catalog?collection=14ers">14ers</Link>
              <Link href="/explore/trails/catalog?collection=8000m">8,000 m peaks</Link>
              <Link href="/explore/trails/catalog?collection=7summits">Seven Summits</Link>
              <Link href="/explore/ski">Ski maps</Link>
            </div>
            <div className="catalog-filter-footer">
              <button className="catalog-button" type="submit">
                Apply filters
              </button>
            </div>
          </div>
        </details>
      </form>
      <CatalogMap
        trails={trails}
        mapData={mapData}
        query={params.toString()}
        summary={resultSummary}
        tools={
          <>
            {hasFilters && (
              <Link className="catalog-link" href="/explore/trails/catalog">
                Clear filters
              </Link>
            )}
            <Link className="catalog-link" href="/explore/trails/catalog?collection=community">
              Community & GPX
            </Link>
          </>
        }
      >
        <section className="catalog-results" aria-label="Trail search results">
          {trails.length > 0 ? (
            <>
              <ul className="catalog-list">
                {trails.map((t) => (
                  <li key={t.id}>
                    <Link href={`/explore/trails/${t.id}`} prefetch={false} className="catalog-row">
                      <div className="catalog-row-name">
                        <h2>{t.name}</h2>
                        <span className="catalog-badges">
                          {t.peakCategory && (
                            <span className="catalog-badge" style={{ background: "#7c3aed", color: "#fff", fontWeight: "bold" }}>
                              {t.peakCategory === "14er" ? "14er" : t.peakCategory === "8000m" ? "8,000m" : "Seven Summits"}
                            </span>
                          )}
                          {t.kind === "route" && !t.peakCategory && <span className="catalog-badge">Through-hike</span>}
                          {t.partOfRoute && (
                            <span className="catalog-badge">Part of {t.partOfRoute.name}</span>
                          )}
                          {t.quality && t.quality !== "ok" && (
                            <span className={`catalog-badge quality-${t.quality}`}>{QUALITY_STATUS_LABELS[t.quality]}</span>
                          )}
                        </span>
                        <p>
                          {t.region ?? countryName(t.country)} · {trailPlace(t)}
 · {(() => { const d = trailDifficulty(t); return <span className="catalog-difficulty"><i style={{ background: DIFFICULTY_COLORS[d === "expert" ? "x" : d[0]] }} aria-hidden="true" />{d}</span>; })()}
                          {t.sections && t.sections.length > 0 ? ` · ${t.sections.length} sections` : ""}
                          {t.summitElevationFt ? ` · Summit ${t.summitElevationFt.toLocaleString()} ft` : ""}
                        </p>
                      </div>
                      <span className="catalog-distance">
                        {displayMiles(t.miles)}
                      </span>
                      <NavIcon name="chevron" />
                    </Link>
                  </li>
                ))}
              </ul>
              {preview ? (
                <div className="catalog-preview-footer">
                  <span>
                    Showing the first {trails.length} of {total.toLocaleString("en-US")} {total === 1 ? "trail" : "trails"}
                  </span>
                  {total > trails.length && (
                    <Link className="catalog-button secondary" href={`/explore/trails/catalog?${allParams}`}>
                      More trails
                    </Link>
                  )}
                </div>
              ) : (
                <nav className="catalog-pagination" aria-label="Catalog pages">
                  {page > 1 ? (
                    <Link className="catalog-button secondary" href={pageHref(page - 1)}>
                      Previous
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span>
                    {((page - 1) * limit + 1).toLocaleString("en-US")}–
                    {Math.min(page * limit, total).toLocaleString("en-US")} · Page{" "}
                    {page.toLocaleString("en-US")}/{pages.toLocaleString("en-US")}
                  </span>
                  {page < pages ? (
                    <Link className="catalog-button secondary" href={pageHref(page + 1)}>
                      Next
                    </Link>
                  ) : (
                    <span />
                  )}
                </nav>
              )}
            </>
          ) : (
            <div className="catalog-empty">
              <h2>Try a broader search.</h2>
              <p>
                {activity === "ski"
                  ? "Few catalog sections use ski in the name. Open Ski maps for nordic ski trails, or clear filters."
                  : "Search a trail name, browse through-hikes, or clear country and distance filters."}
              </p>
              {activity === "ski" ? (
                <div className="catalog-quick-links">
                  <Link href="/explore/ski" className="catalog-button secondary">
                    Ski maps
                  </Link>
                  <Link href="/explore/trails/catalog" className="catalog-button secondary">
                    Show hiking trails
                  </Link>
                </div>
              ) : (
                <Link href="/explore/trails/catalog" className="catalog-button secondary">
                  Show all trails
                </Link>
              )}
            </div>
          )}
        </section>
      </CatalogMap>
      <p className="catalog-source-line">
        Trail data from park and forest agencies and community trail maps. <Link className="catalog-link" href="/about/data">Sources and licences</Link>
      </p>
    </div>
  );
}
