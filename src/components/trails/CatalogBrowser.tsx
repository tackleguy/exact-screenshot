import Link from "next/link";
import { searchCatalog, searchCatalogMap } from "@/lib/trail-catalog/server";
import { parseCatalogFilters } from "@/lib/trail-catalog/search";
import { countryName, displayMiles, trailPlace } from "@/lib/trail-catalog/types";
import { QUALITY_STATUS_LABELS } from "@/lib/trail-catalog/quality";
import { CatalogMap } from "./CatalogMap";
import { NavIcon } from "@/components/nav/NavIcon";
import "./catalog.css";

export async function CatalogBrowser({ params }: { params: URLSearchParams }) {
  const filters = parseCatalogFilters(params);
  const preview = filters.limit === undefined && (!filters.page || filters.page === 1);
  const [result, mapData] = await Promise.all([
    searchCatalog({ ...filters, limit: preview ? 4 : filters.limit }).catch(() => null),
    searchCatalogMap(filters).catch(() => null),
  ]);
  if (!result) {
    return (
      <div className="catalog-shell">
        <h1>Trail catalog unavailable</h1>
        <p>Please reload to try again.</p>
        <Link className="catalog-link" href="/explore/trails">
          Reload catalog
        </Link>
      </div>
    );
  }
  const { trails, total, page, pages, limit, manifest } = result;
  const activity = filters.activity ?? "hike";
  const filterSummary = [
    filters.bbox && "Map area",
    filters.country === "intl"
      ? "International"
      : filters.country && countryName(filters.country),
    filters.kind === "route" && "Through-hikes",
    filters.kind === "segment" && "Sections only",
    activity === "ski" && "Ski trails",
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
    return `/explore/trails?${next}`;
  }
  const intlCount = Object.entries(manifest.countries)
    .filter(([code]) => code !== "US" && code !== "CA")
    .reduce((sum, [, count]) => sum + count, 0);

  return (
    <div className="catalog-shell">
      <header className="catalog-heading">
        <h1>Find your next trail.</h1>
        <p>
          {(manifest.publicTotal ?? manifest.total).toLocaleString("en-US")} trails — whole mapped trails across the United
          States and Canada, plus curated through-hikes worldwide.
        </p>
        <div className="catalog-quick-links">
          <Link className="catalog-button secondary" href="/explore/trails?kind=route">
            Through-hikes
          </Link>
          <Link className="catalog-button secondary" href="/explore/trails?country=intl&kind=route">
            International
          </Link>
          <Link
            className="catalog-button secondary"
            href="/explore/trails?activity=ski&includeWinter=true"
          >
            Ski trails
          </Link>
          <Link className="catalog-button secondary" href="/explore/ski">
            Ski maps
          </Link>
          <Link className="catalog-button secondary" href="/explore/trails?uniqueNames=true">
            Unique names
          </Link>
        </div>
        <Link className="catalog-mobile-plan" href="/plan">
          Have a trip in mind? Plan it
        </Link>
      </header>
      <form className="catalog-filters" action="/explore/trails">
        {!preview && <input type="hidden" name="limit" value={limit} />}
        {filters.bbox && <input type="hidden" name="bbox" value={filters.bbox.join(",")} />}
        {activity !== "hike" && activity !== "all" && (
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
        summary={
          total
            ? `${total.toLocaleString("en-US")} ${total === 1 ? "match" : "matches"}${
                params.get("region") ? ` in ${params.get("region")}` : ""
              }`
            : "No matching trails"
        }
        tools={
          <>
            {hasFilters && (
              <Link className="catalog-link" href="/explore/trails">
                Clear filters
              </Link>
            )}
            <Link className="catalog-link" href="/explore/trails?collection=community">
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
                          {t.kind === "route" && <span className="catalog-badge">Through-hike</span>}
                          {t.quality && t.quality !== "ok" && (
                            <span className={`catalog-badge quality-${t.quality}`}>{QUALITY_STATUS_LABELS[t.quality]}</span>
                          )}
                        </h2>
                        <p>
                          {t.region ?? countryName(t.country)} · {trailPlace(t)}
                          {t.difficulty ? ` · ${t.difficulty}` : ""}
                          {t.sectionCount && t.sectionCount > 1 ? ` · ${t.sectionCount.toLocaleString("en-US")} sections joined` : ""}
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
                    Showing a preview of {total.toLocaleString("en-US")}{" "}
                    {total === 1 ? "match" : "matches"}
                  </span>
                  {total > trails.length && (
                    <Link className="catalog-button secondary" href={`/explore/trails?${allParams}`}>
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
                  <Link href="/explore/trails" className="catalog-button secondary">
                    Show hiking trails
                  </Link>
                </div>
              ) : (
                <Link href="/explore/trails" className="catalog-button secondary">
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
