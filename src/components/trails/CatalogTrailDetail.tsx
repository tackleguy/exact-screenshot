import { formatElevation } from "@/lib/units";
import Link from "next/link";
import { CatalogMapView } from "./CatalogMapView";
import { TrailMapAndDirections } from "./TrailMapAndDirections";
import { TripTools } from "./TripTools";
import { TrailElevationSection } from "./TrailElevationSection";
import { TrailFeatureList } from "./TrailFeatureList";
import { CatalogPhotos } from "./CatalogPhotos";
import { googleMapsDirectionsUrl } from "@/lib/trail-catalog/access";
import { TrailWeatherForecast } from "./TrailWeatherForecast";
import type { CatalogManifest, CatalogTrail } from "@/lib/trail-catalog/types";
import { countryName, sourceName } from "@/lib/trail-catalog/types";
import { CONFIDENCE_LABELS, SOURCE_TYPE_LABELS, TRAIL_TYPE_LABELS } from "@/lib/trail-catalog/agencies";
import { QUALITY_FLAGS, QUALITY_STATUS_LABELS, formatDistance } from "@/lib/trail-catalog/quality";
import { DIFFICULTY_FORMULA, DIFFICULTY_LABELS, trailDifficulty } from "@/lib/trail-difficulty";
import { CatalogTrailHero } from "./CatalogTrailHero";
import "./catalog.css";
import { trailSacScale } from "@/lib/trail-catalog/types";

export function CatalogTrailDetail({
  trail: t,
  lines,
  manifest,
  parent = null,
}: {
  trail: CatalogTrail;
  lines: [number, number][][];
  manifest: CatalogManifest;
  parent?: { id: string; name: string; miles: number | null } | null;
}) {
  const distance = formatDistance(t.miles);
  const lastChecked = manifest.sources.find((m) => m.key === t.source)?.retrievedAt?.slice(0, 10) ?? null;
  const flags = t.flags ?? [];
  const warning = t.flags?.includes("sidewalk") || t.flags?.includes("motorized") || (t.quality && t.quality !== "ok" && t.quality !== "short") ? qualityWarning(t, parent) : null;
  const isRoute = t.kind === "route";
  const sections = t.sectionCount ?? 1;
  const hasLines = lines.length > 0;
  const hasLocation = Math.abs(t.latitude) > 0.1 || Math.abs(t.longitude) > 0.1;
  const browse = new URLSearchParams({
    ...(t.country === "US" || t.country === "CA" ? { country: t.country } : { country: "intl" }),
    ...(isRoute ? { kind: "route" } : {}),
    ...(t.region && (t.country === "US" || t.country === "CA") ? { region: t.region } : {}),
  });
  const difficulty = trailDifficulty(t);

  return (
    <article className="catalog-shell catalog-detail">
      <Link className="catalog-link" href={`/explore/trails?${browse}`}>
        ← Browse {isRoute ? "through-hikes" : (t.region ?? countryName(t.country))}
      </Link>
      <CatalogTrailHero trail={t} difficulty={difficulty} distance={distance.primary} hasLines={hasLines} />
      {t.peakCategory && (
        <p className="trail-notes">
          <span className="catalog-badge">{t.peakCategory === "14er" ? "14er · 14,000+ ft peak" : t.peakCategory === "8000m" ? "8,000 m peak" : "Seven Summits"}</span>
          {t.summitElevationFt && <span className="catalog-badge">Summit {formatElevation(t.summitElevationFt)}</span>}
        </p>
      )}
      {t.partOfRoute && (
        <p className="trail-callout">
          Part of <Link className="catalog-link" href={`/explore/trails/${encodeURIComponent(t.partOfRoute.id)}`}>{t.partOfRoute.name}</Link>
          {t.partOfRoute.totalMiles > 0 && <> · {formatDistance(t.partOfRoute.totalMiles).primary} in all</>}
        </p>
      )}
      {t.linkedTrailId && t.linkedTrailId !== t.id && (
        <p className="catalog-section-note">
          This guide’s map shows <Link className="catalog-link" href={`/explore/trails/${encodeURIComponent(t.linkedTrailId)}`}>the matching trail</Link>.
        </p>
      )}
      {t.winterUse && (
        <p className="trail-callout">
          {t.winterUse === "downhill"
            ? <><strong>Ski or sled run{t.skiArea ? ` at ${t.skiArea}` : ""}.</strong> A winter run; resorts set their own rules for summer access.</>
            : t.winterUse === "oversnow"
              ? <><strong>Winter route.</strong> Mapped for skiing, snowshoeing or snowmobiles.</>
              : <><strong>Nordic ski track{t.skiArea ? ` at ${t.skiArea}` : ""}.</strong> Groomed for cross-country skiing in winter.</>}
        </p>
      )}
      {warning && (
        <p className="trail-callout trail-callout--warn" role="note">
          <strong>{t.flags?.includes("motorized") ? "Motorized route" : t.flags?.includes("sidewalk") ? "Sidewalk or road path" : QUALITY_STATUS_LABELS[t.quality!]}.</strong> {warning}
          {parent && <> <Link className="catalog-link" href={`/explore/trails/${encodeURIComponent(parent.id)}`}>View {parent.name} ({formatDistance(parent.miles).primary})</Link></>}
        </p>
      )}
      {(t.wiki?.extract || t.osm?.description || isRoute || (t.source === "resort" && t.note)) && (
        <section className="catalog-about" aria-label="About this trail">
          <p>{t.wiki?.extract ?? t.osm?.description ?? (t.source === "resort" ? t.note : t.note ?? "A through-hike guide. Confirm distance, permits and current conditions with the trail association or land manager.")}</p>
          {t.wiki?.extract && <p className="catalog-muted">From <a href={t.wiki.url} target="_blank" rel="noopener noreferrer">Wikipedia</a> (CC BY-SA 4.0).</p>}
        </section>
      )}
      {t.sections && t.sections.length > 0 && (
        <section className="trail-sections" aria-labelledby="trail-sections-heading">
          <h2 id="trail-sections-heading">Sections <small>{t.sections.length}</small></h2>
          <ol>
            {t.sections.map((sec) => (
              <li key={sec.id}>
                <Link href={`/explore/trails/${encodeURIComponent(sec.id)}`}>
                  <span>{sec.name}</span>
                  {sec.miles > 0 && <small>{formatDistance(sec.miles).primary}</small>}
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}
      <h2 className="trail-heading">{hasLines ? "Map" : "Approximate location"}</h2>
      {hasLines && !isRoute ? (
        <TrailMapAndDirections name={t.name} lines={lines} trailhead={t.trailhead?.kind === "trail-end" ? undefined : t.trailhead} landManager={{ name: t.park ?? t.forest ?? t.manager, url: t.officialUrl ?? (t.source !== "osm" ? t.sourceUrl : null) }}>
          <TrailElevationSection trailId={t.id} stored={t} />
        </TrailMapAndDirections>
      ) : (
        <>
          <CatalogMapView lines={hasLines ? lines : undefined} trails={hasLines ? undefined : [t]} name={t.name} />
          {!hasLines && (
            <p className="catalog-muted">
              {t.source === "resort" ? "Pin marks the resort base area; the resort doesn’t publish this trail’s route." : "Pin marks an approximate trailhead or corridor midpoint, not a GPS track."}
              {hasLocation && <> <a href={googleMapsDirectionsUrl(t.latitude, t.longitude)} target="_blank" rel="noopener noreferrer">Directions in Google Maps</a></>}
            </p>
          )}
          {hasLines && <TrailElevationSection trailId={t.id} stored={t} />}
        </>
      )}
      {hasLocation && (
        <details className="trail-more">
          <summary><span>Weather</span><small>7-day forecast near the trail</small></summary>
          <TrailWeatherForecast variant="catalog" lat={t.latitude} lng={t.longitude} locationLabel={isRoute && !hasLines ? "approximate trailhead" : "map pin"} />
        </details>
      )}
      {hasLines && (
        <details className="trail-more">
          <summary><span>Along the trail</span><small>Water, campsites, shelters and viewpoints by mile</small></summary>
          <TrailFeatureList trailId={t.id} hasLine={hasLines} />
        </details>
      )}
      <details className="trail-more">
        <summary><span>Trip planning</span><small>Water stretches, nearby towns, resupply days and downloads</small></summary>
        <TripTools trailId={t.id} hasLine={hasLines} miles={t.miles} />
      </details>
      {hasLocation && (
        <details className="trail-more">
          <summary><span>Photos</span><small>Photos from near the trail</small></summary>
          <CatalogPhotos trailId={t.id} />
        </details>
      )}
      <details className="trail-more">
        <summary><span>About this data</span><small>Sources, checks and licences</small></summary>
        <dl className="catalog-source-details">
          <div>
            <dt>Distance</dt>
            <dd>{distance.primary}{distance.secondary && ` · ${distance.secondary}`} <small className="catalog-muted">{isRoute ? (t.source === "route-aggregate" ? "official corridor length" : "guide length") : sections > 1 ? `${sections.toLocaleString("en-US")} sections joined` : t.source === "resort" ? "stated by the resort" : t.distanceBasis === "geometry" ? "measured along the mapped line" : "reported by the source"}{t.routeType === "point-to-point" && !isRoute ? "; one way" : ""}</small></dd>
          </div>
          <div>
            <dt>Difficulty</dt>
            <dd>{DIFFICULTY_LABELS[difficulty]} <small className="catalog-muted" title={DIFFICULTY_FORMULA}>from length{Number.isFinite(t.gainFt) ? " and measured climb" : ""}</small></dd>
          </div>
          <div>
            <dt>Dogs</dt>
            <dd>{t.dogs === true ? "Source reports allowed" : t.dogs === false ? "Source reports not allowed" : "Not reported"}</dd>
          </div>
          <div>
            <dt>Managed by</dt>
            <dd>{t.manager ?? (t.source === "osm" ? "Not reported" : sourceName(t.source))}</dd>
          </div>
          {t.sourceType && (
            <div>
              <dt>Source</dt>
              <dd>{t.source === "osm" ? (t.osm ? "Mapped route" : "Mapped trail") : SOURCE_TYPE_LABELS[t.sourceType]}{lastChecked && <small className="catalog-muted"> · checked {lastChecked}</small>}</dd>
            </div>
          )}
          {t.confidence && (
            <div>
              <dt>Confidence</dt>
              <dd>{CONFIDENCE_LABELS[t.confidence]}</dd>
            </div>
          )}
          {t.officialTrailId && (
            <div>
              <dt>Official trail number</dt>
              <dd>#{t.officialTrailId}</dd>
            </div>
          )}
          {(t.forest ?? t.park ?? t.blmArea ?? t.skiResort) && (
            <div>
              <dt>{t.forest ? "National forest" : t.park ? "Park" : t.blmArea ? "BLM area" : "Ski resort"}</dt>
              <dd>
                {t.skiResort && !t.forest && !t.park && !t.blmArea ? (
                  <Link className="catalog-link" href={`/explore/trails?resort=${encodeURIComponent(t.skiResort)}`}>{t.skiResort} hiking trails</Link>
                ) : (
                  t.forest ?? t.park ?? t.blmArea
                )}
              </dd>
            </div>
          )}
          {(t.trailType || t.uses?.length) && (
            <div>
              <dt>Uses</dt>
              <dd>{[t.trailType ? TRAIL_TYPE_LABELS[t.trailType] : null, ...(t.uses ?? [])].filter(Boolean).join(", ")}</dd>
            </div>
          )}
          {t.trailStatus && t.trailStatus !== "UNKNOWN" && (
            <div>
              <dt>Status</dt>
              <dd>{{ OPEN: "Open", CLOSED: "Closed", SEASONAL: "Seasonal", RESTRICTED: "Access restricted", UNKNOWN: "Not reported" }[t.trailStatus]}</dd>
            </div>
          )}
          {t.surface && (
            <div>
              <dt>Surface</dt>
              <dd>{t.surface}</dd>
            </div>
          )}
          {t.season && (
            <div>
              <dt>Season</dt>
              <dd>{t.season}</dd>
            </div>
          )}
          {t.originalName && (
            <div>
              <dt>Name in source</dt>
              <dd>{t.originalName}</dd>
            </div>
          )}
          {t.quality && (
            <div>
              <dt>Data checks</dt>
              <dd>
                {QUALITY_STATUS_LABELS[t.quality]} ({manifest.generatedAt.slice(0, 10)})
                {flags.length > 0 && (
                  <ul className="catalog-flag-list">
                    {flags.map((flag) => <li key={flag}>{QUALITY_FLAGS[flag]}</li>)}
                  </ul>
                )}
              </dd>
            </div>
          )}
        </dl>
        {t.sources && t.sources.length > 0 && (
          <p className="catalog-muted">
            {t.source === "osm" ? "Official records:" : "Also mapped in:"}{" "}
            {/* One link per distinct source, with a count when an agency mapped several pieces. */}
            {[...new Map(t.sources.map((ref) => [`${ref.type}:${ref.officialTrailId ?? ""}`, ref])).values()].map((ref, i) => {
              const pieces = t.sources!.filter((x) => x.type === ref.type && (x.officialTrailId ?? "") === (ref.officialTrailId ?? "")).length;
              return (
                <span key={`${ref.type}-${ref.id}`}>
                  {i > 0 && " · "}
                  <a href={ref.url} target="_blank" rel="noopener noreferrer">
                    {SOURCE_TYPE_LABELS[ref.type]}
                    {ref.officialTrailId ? ` trail #${ref.officialTrailId}` : ""}
                    {pieces > 1 ? ` (${pieces} sections)` : ref.name !== t.name ? ` (“${ref.name}”)` : ""}
                  </a>
                </span>
              );
            })}
          </p>
        )}
        <p>
          <a href={t.sourceUrl} target="_blank" rel="noopener noreferrer">{isRoute ? "Official trail information" : t.source === "resort" ? "Resort’s summer trail information" : "View the source record"}</a>
          {t.officialUrl && t.officialUrl !== t.sourceUrl && <> · <a href={t.officialUrl} target="_blank" rel="noopener noreferrer">Land manager’s website</a></>}
        </p>
        <p className="catalog-muted">
          {t.source === "osm" || t.osm || t.sources?.some((ref) => ref.type === "OPENSTREETMAP") ? "Trail line © OpenStreetMap contributors (ODbL). " : ""}
          {t.country === "CA" && !isRoute && (
            <>Contains information licensed under the <a href={t.source === "ontario" ? "https://www.ontario.ca/page/open-government-licence-ontario" : "https://open.canada.ca/en/open-government-licence-canada"} target="_blank" rel="noopener noreferrer">Open Government Licence – {t.source === "ontario" ? "Ontario" : "Canada"}</a>. </>
          )}
          Region is estimated from a point on the trail. Snapshot {manifest.generatedAt.slice(0, 10)} · ID {t.sourceId}.
        </p>
      </details>
    </article>
  );
}

function qualityWarning(t: CatalogTrail, parent: { name: string } | null) {
  const flags = t.flags ?? [];
  if (flags.includes("fragment-of-longer-trail")) {
    return `This is a separately mapped piece of ${parent?.name ?? "a longer trail with the same name"}. The source has a gap between them, so they are not joined here and this distance is not the full hike.`;
  }
  if (flags.includes("motorized")) return "The source names this as an ATV, OHV, motorcycle or 4x4 route, so it is left out of hiking results. Hikers may share it with vehicles.";
  if (flags.includes("sidewalk")) return "This looks like a sidewalk, road sidepath or on-street bike lane rather than a trail, so it is left out of hiking results.";
  if (flags.includes("closed")) return "The source name marks this trail as closed or abandoned. Check with the land manager before going.";
  if (flags.includes("incomplete-geometry")) {
    return `The source reports ${formatDistance(t.reportedMiles ?? null).primary} for this trail, but only ${formatDistance(t.miles).primary} is mapped. Sections are missing from the map.`;
  }
  if (flags.includes("unnamed") || flags.includes("placeholder-name")) return "This unnamed mapped path is probably a connector or part of a larger network, not a destination hike.";
  if (flags.includes("connector")) return "This is a connector, spur or access path, not a full hike on its own.";
  if (flags.includes("network-name")) return "The source gives this name to many separate paths in the area. This record is one short piece of that network.";
  if (flags.includes("distance-mismatch")) {
    return `The source reports ${formatDistance(t.reportedMiles ?? null).primary}, but the mapped line measures ${formatDistance(t.miles).primary}. The mapped length is shown.`;
  }
  if (flags.includes("disconnected")) return "The mapped line has gaps between its pieces. The gaps are not filled in, and the distance counts only the mapped parts.";
  if (flags.includes("gps-jump") || flags.includes("straight-line")) return "Part of this line is a long straight jump in the source geometry, so it may not follow the real path.";
  if (flags.includes("invalid-geometry")) return "This record has no usable map geometry.";
  return "Automated checks found a problem with this record.";
}
