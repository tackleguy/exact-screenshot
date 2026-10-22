import Link from "next/link";
import type { CatalogManifest, CatalogTrail, CatalogMapResult } from "@/lib/trail-catalog/types";
import { parseCatalogFilters } from "@/lib/trail-catalog/search";
import { headlineCount, countryName, displayMiles, trailPlace } from "@/lib/trail-catalog/types";
import { QUALITY_STATUS_LABELS } from "@/lib/trail-catalog/quality";
import { CatalogMap } from "@/components/trails/CatalogMap";
import { NavIcon } from "@/components/nav/NavIcon";
import { SectionIcon } from "@/components/explore/SectionIcon";
import { CATALOG_ACTIVITY_LABELS, TRAIL_SECTIONS, sectionOf } from "@/lib/trail-catalog/activity";
import "@/components/trails/catalog.css";

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
    filters.minMiles !== undefined && `${filters.minMiles}+ mi`,
    filters.maxMiles !== undefined && `Up to ${filters.maxMiles} mi`,
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
  const intlCount = Object.entries(manifest.countries)
    .filter(([code]) => code !== "US" && code !== "CA")
    .reduce((sum, [, count]) => sum + count, 0);

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
        <p>
          {headlineCount(manifest).toLocaleString("en-US")} trails across the United States and Canada
          {manifest.tiers ? ` (${manifest.tiers.verified.toLocaleString("en-US")} verified by an agency or route relation, ${manifest.tiers.mapped.toLocaleString("en-US")} mapped in OpenStreetMap)` : ""}, plus curated
          through-hikes, 14ers and world summits.
        </p>
        <div className="catalog-quick-links">
          <Link className="catalog-button secondary" href="/explore/trails/catalog?collection=thru-hikes">
            Through-hikes
          </Link>
          <Link className="catalog-button secondary" href="/explore/trails/catalog?collection=thru-sections">
            Through-hike sections
          </Link>
          <Link className="catalog-button secondary" href="/explore/trails/catalog?collection=14ers">
            14ers
          </Link>
          <Link className="catalog-button secondary" href="/explore/trails/catalog?collection=8000m">
            8,000 m peaks
          </Link>
          <Link className="catalog-button secondary" href="/explore/trails/catalog?collection=7summits">
            Seven Summits
          </Link>
          <Link className="catalog-button secondary" href="/explore/trails/catalog?country=intl&kind=route">
            International
          </Link>
          <Link className="catalog-button secondary" href="/explore/ski">
            Ski maps
          </Link>
        </div>
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
        {activity === "ski" && <input type="hidden" name="includeWinter" value="true" />}
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
                  <option value="intl">International</option>
                  {manifest.countries.FR != null && <option value="FR">France</option>}
                  {manifest.countries.NZ != null && <option value="NZ">New Zealand</option>}
                  {manifest.countries.NP != null && <option value="NP">Nepal</option>}
                  {manifest.countries.ES != null && <option value="ES">Spain</option>}
                  {manifest.countries.IS != null && <option value="IS">Iceland</option>}
                  {manifest.countries.CL != null && <option value="CL">Chile</option>}
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
                Minimum miles
                <input
                  name="minMiles"
                  type="number"
                  min="0"
                  max="10000"
                  step="any"
                  defaultValue={params.get("minMiles") ?? ""}
                  placeholder="Any"
                />
              </label>
              <label>
                Maximum miles
                <input
                  name="maxMiles"
                  type="number"
                  min="0"
                  max="10000"
                  step="any"
                  defaultValue={params.get("maxMiles") ?? ""}
                  placeholder="Any"
                />
              </label>
              <label className="catalog-checkbox">
                <input
                  type="checkbox"
                  name="uniqueNames"
                  value="true"
                  defaultChecked={params.get("uniqueNames") === "true"}
                />
                One card per trail name
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
            <div className="catalog-filter-footer">
              <p className="catalog-muted">
                Through-hikes are end-to-end routes. Separate trails can share a common name (for example
                “Loop Trail”) — use unique names to collapse repeats. Pieces of longer trails, unnamed
                stubs, connectors, sidewalks and closed trails are hidden unless you include partial segments.
              </p>
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
                        <h2>
                          {t.name}
                          {t.peakCategory && (
                            <span className="catalog-badge" style={{ background: "#7c3aed", color: "#fff", fontWeight: "bold" }}>
                              {t.peakCategory === "14er" ? "14er" : t.peakCategory === "8000m" ? "8,000m" : "Seven Summits"}
                            </span>
                          )}
                          {t.kind === "route" && !t.peakCategory && <span className="catalog-badge">Through-hike</span>}
                          {t.partOfRoute && (
                            <span className="catalog-badge" style={{ background: "#2563eb", color: "#fff" }}>
                              Section of {t.partOfRoute.name}
                            </span>
                          )}
                          {t.quality && t.quality !== "ok" && (
                            <span className={`catalog-badge quality-${t.quality}`}>{QUALITY_STATUS_LABELS[t.quality]}</span>
                          )}
                        </h2>
                        <p>
                          {t.region ?? countryName(t.country)} · {trailPlace(t)}
                          {t.difficulty ? ` · ${t.difficulty}` : ""}
                          {t.sections && t.sections.length > 0
                            ? ` · ${t.sections.length} defined sections`
                            : t.sectionCount && t.sectionCount > 1
                              ? ` · ${t.sectionCount.toLocaleString("en-US")} sections joined`
                              : ""}
                          {t.summitElevationFt ? ` · Summit ${t.summitElevationFt.toLocaleString()} ft` : ""}
                        </p>
                      </div>
                      <span className="catalog-distance">
                        {displayMiles(t.miles)}
                        <small>
                          {t.kind === "route"
                            ? "route"
                            : t.distanceBasis === "geometry"
                              ? "measured"
                              : "trail"}
                        </small>
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
                  ? "Few catalog sections use ski in the name. Open Ski maps for nordic OSM trails, or clear filters."
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
        <aside className="catalog-planning" aria-labelledby="catalog-planning-title">
          <h2 id="catalog-planning-title">A trip, in your words.</h2>
          <p>Start with a place, distance and time. Build a route and pack around your own gear.</p>
          <div className="catalog-example">
            <strong>30 miles, 3 days in Colorado</strong>
            <span>Example request</span>
          </div>
          <Link className="catalog-button" href="/plan?prompt=30%20miles%2C%203%20days%20in%20Colorado">
            Plan this trip
          </Link>
          <hr />
          <h3>Made for your next outing</h3>
          <p>Your gear and past trips help shape the plan. Review the sources before you go.</p>
          <Link className="catalog-link" href="/plan">
            Start with your own idea
          </Link>
        </aside>
      </CatalogMap>
      <section className="catalog-source-summary">
        <h2>Whole trails, with their sources.</h2>
        <p>
          Connected source sections that share a name are joined into one trail, and its length counts
          overlapping sections once. Distances and access still need a check with the land manager.
        </p>
        <details className="catalog-sources">
          <summary>USGS · National Park Service · U.S. Forest Service · BLM · Parks Canada · Ontario · ski resorts · curated guides — View sources & coverage</summary>
          <p>
            {(manifest.countries.CA ?? 0).toLocaleString("en-US")} Canadian and{" "}
            {(manifest.countries.US ?? 0).toLocaleString("en-US")} U.S. records
            {intlCount > 0
              ? `, plus ${intlCount.toLocaleString("en-US")} international through-hike guides`
              : ""}
            . Snapshot created {manifest.generatedAt.slice(0, 10)}.
          </p>
          {manifest.sectionTotal != null && (
            <p>
              Built from {manifest.sectionTotal.toLocaleString("en-US")} mapped source sections.
            </p>
          )}
          <ul>
            {manifest.sources.map((s) => (
              <li key={s.name}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.name}
                </a>{" "}
                — {s.license}.{s.count > 0 ? ` ${s.count.toLocaleString("en-US")} sections.` : ""}
              </li>
            ))}
          </ul>
          <p>
            Canadian coverage comes from Parks Canada locations and the Ontario Trail Network. U.S.
            coverage is every named USGS trail plus unnamed trails marked for hiking, checked against and
            extended with official National Park Service, U.S. Forest Service and BLM trail data. Ski resort
            summer trails are listed by name and stated length from each resort’s own site. National Scenic
            and long trails are joined end to end. International through-hikes are curated guides (not GPS tracks). State
            and province labels use approximate{" "}
            <a
              href="https://www.naturalearthdata.com/about/terms-of-use/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Natural Earth
            </a>{" "}
            boundaries.
          </p>
          <p>
            Contains information licensed under the{" "}
            <a
              href="https://open.canada.ca/en/open-government-licence-canada"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Government Licence – Canada
            </a>{" "}
            and the{" "}
            <a
              href="https://www.ontario.ca/page/open-government-licence-ontario"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Government Licence – Ontario
            </a>
            .
          </p>
          <a href="/api/trail-catalog/download" download>
            Download the catalog index (compressed JSON)
          </a>
        </details>
      </section>
    </div>
  );
}
