import Link from "next/link";
import { CatalogPhotos } from "./CatalogPhotos";
import { CatalogMapView } from "./CatalogMapView";
import { TrailMapAndDirections } from "./TrailMapAndDirections";
import { TripTools } from "./TripTools";
import { googleMapsDirectionsUrl } from "@/lib/trail-catalog/access";
import { TrailWeatherForecast } from "./TrailWeatherForecast";
import type { CatalogManifest, CatalogTrail } from "@/lib/trail-catalog/types";
import { countryName, sourceName, trailPlace } from "@/lib/trail-catalog/types";
import { CONFIDENCE_LABELS, SOURCE_TYPE_LABELS, TRAIL_TYPE_LABELS } from "@/lib/trail-catalog/agencies";
import { QUALITY_FLAGS, QUALITY_STATUS_LABELS, ROUTE_TYPE_LABELS, formatDistance } from "@/lib/trail-catalog/quality";
import { resolveDifficulty } from "@/lib/trail-difficulty";
import "./catalog.css";

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
  const difficulty = resolveDifficulty({
    reported: t.difficulty,
    miles: t.miles,
    name: t.name,
  });

  return (
    <article className="catalog-shell catalog-detail">
      <Link className="catalog-link" href={`/explore/trails?${browse}`}>
        ← Browse {isRoute ? "through-hikes" : (t.region ?? countryName(t.country))}
      </Link>
      <header>
        <h1>
          {t.name}
          {isRoute && <span className="catalog-badge">Through-hike</span>}
        </h1>
        <p>
          {[t.region, countryName(t.country)].filter(Boolean).join(", ")} · {trailPlace(t)}
        </p>
      </header>
      {t.winterUse && (
        <div className="catalog-quality-note" role="note">
          {t.winterUse === "downhill" ? (
            <>
              <strong>Downhill ski run{t.skiArea ? ` at ${t.skiArea}` : ""}.</strong> This line follows a mapped ski piste,
              so it is listed with ski trails, not hikes. Resorts set their own rules for summer access and uphill travel.
            </>
          ) : t.winterUse === "oversnow" ? (
            <>
              <strong>Winter over-snow route.</strong> This is mapped as a snowmobile, ski or snowshoe route
              (for example a U.S. Forest Service snow trail), so it is listed with ski trails, not hikes.
            </>
          ) : (
            <>
              <strong>Nordic ski track{t.skiArea ? ` at ${t.skiArea}` : ""}.</strong> This trail is groomed for
              cross-country skiing in winter; check whether walking is allowed on the tracks then.
            </>
          )}
        </div>
      )}
      {warning && (
        <div className="catalog-quality-note" role="note">
          <strong>{t.flags?.includes("motorized") ? "Motorized route" : t.flags?.includes("sidewalk") ? "Sidewalk or road path" : QUALITY_STATUS_LABELS[t.quality!]}.</strong> {warning}
          {parent && (
            <>
              {" "}
              <Link className="catalog-link" href={`/explore/trails/${encodeURIComponent(parent.id)}`}>
                View {parent.name} ({formatDistance(parent.miles).primary})
              </Link>
            </>
          )}
        </div>
      )}
      <p className="catalog-section-note">
        {isRoute
          ? t.note ??
            "This is a through-hike / long-route guide. Confirm distance, permits, and current conditions with the official trail association or land manager."
          : t.source === "resort" && t.note
            ? t.note
          : sections > 1
            ? `This trail joins ${sections.toLocaleString("en-US")} connected source sections that share its name. It may link to other trails; check access, trailheads and the complete route before planning your hike.`
            : "This record is a mapped trail. It may link to other trails; check access, trailheads and the complete route before planning your hike."}
      </p>
      <dl className="catalog-facts">
        <div>
          <dt>{isRoute ? "Route distance" : "Trail distance"}</dt>
          <dd>
            {distance.primary}
            {distance.secondary && <span className="catalog-distance-alt"> · {distance.secondary}</span>}
            <small>
              {isRoute
                ? t.source === "route-aggregate"
                  ? "Official corridor length"
                  : "Curated guide length"
                : sections > 1
                  ? `Sum of ${sections.toLocaleString("en-US")} mapped sections, overlaps counted once`
                  : t.source === "resort"
                    ? "Stated by the resort"
                  : t.distanceBasis === "geometry"
                    ? "Measured along the mapped line"
                    : "Reported by the source; matches the mapped line"}
              {t.routeType === "point-to-point" && !isRoute ? ". One way; double it for an out-and-back." : ""}
            </small>
          </dd>
        </div>
        <div>
          <dt>Difficulty</dt>
          <dd className="capitalize">
            {difficulty.difficulty}
            <small>{difficulty.label}</small>
          </dd>
        </div>
        {t.sectionCount != null && t.sectionCount > 1 ? (
          <div>
            <dt>Mapped sections</dt>
            <dd>
              {t.sectionCount.toLocaleString("en-US")}
              <small>
                {t.mappedMiles != null
                  ? `~${t.mappedMiles.toLocaleString("en-US")} mi mapped`
                  : "Joined into this trail"}
              </small>
            </dd>
          </div>
        ) : (
          <div>
            <dt>Route type</dt>
            <dd>
              {t.routeType ? ROUTE_TYPE_LABELS[t.routeType] : isRoute ? "Long-distance route" : "Not stated"}
              <small>{t.source === "resort" ? "As the resort lists it" : "From the mapped line’s shape"}</small>
            </dd>
          </div>
        )}
        <div>
          <dt>{isRoute ? "Season" : "Dogs"}</dt>
          <dd>
            {isRoute
              ? (t.season ?? "Not reported")
              : t.dogs === true
                ? "Source reports allowed"
                : t.dogs === false
                  ? "Source reports not allowed"
                  : "Not reported"}
          </dd>
        </div>
      </dl>
      {t.tags && t.tags.length > 0 && (
        <ul className="catalog-tag-list">
          {t.tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      )}
      <div className="catalog-detail-map-heading">
        <h2>{hasLines ? (isRoute ? "Mapped route" : "Trail map") : "Approximate location"}</h2>
        {hasLines && (
          <a
            className="catalog-button secondary"
            href={`/api/trail-catalog/${encodeURIComponent(t.id)}/gpx`}
            download
          >
            Download trail GPX
          </a>
        )}
      </div>
      {hasLines && !isRoute ? (
        <TrailMapAndDirections name={t.name} miles={t.miles} lines={lines} trailhead={t.trailhead} />
      ) : hasLines ? (
        <CatalogMapView lines={lines} />
      ) : (
        <CatalogMapView trails={[t]} />
      )}
      <p className="catalog-muted">
        {!hasLines
          ? t.source === "resort"
            ? "Pin marks the resort base area. The resort doesn’t publish this trail’s route, so check its summer trail map before you go."
            : "Pin marks an approximate trailhead or corridor midpoint — not a verified start. This is not a GPS track."
          : isRoute
            ? "Mapped sections joined for discovery; gaps are stretches no source has mapped. This is not a GPS track."
            : "Generalized source geometry for discovery. Trailheads come from OpenStreetMap and are not verified; confirm access, parking and road conditions before you go."}
        {(isRoute || !hasLines) && hasLocation && (
          <>
            {" "}
            <a href={googleMapsDirectionsUrl(t.latitude, t.longitude)} target="_blank" rel="noopener noreferrer">
              Directions to the map pin in Google Maps
            </a>
          </>
        )}
      </p>
      {hasLocation && (
        <TrailWeatherForecast
          variant="catalog"
          lat={t.latitude}
          lng={t.longitude}
          locationLabel={isRoute && !hasLines ? "approximate trailhead" : "map pin"}
        />
      )}
      <TripTools trailId={t.id} hasLine={hasLines} miles={t.miles} />
      {!isRoute && <CatalogPhotos trailId={t.id} />}
      <div className="catalog-detail-grid">
        <section>
          <h2>Plan around the whole route.</h2>
          <p>
            Confirm the full hike and its distance with the land manager, then build your gear list
            and packing plan in Hyked.
          </p>
          <Link
            className="catalog-button"
            href={`/plan?region=${encodeURIComponent(t.region ?? countryName(t.country))}&prompt=${encodeURIComponent(t.name)}`}
          >
            Prepare a trip for {t.name}
          </Link>
          <p className="catalog-muted">
            Camping permission, water availability and current closures are not confirmed by this
            record.
          </p>
        </section>
        <section>
          <h2>Source details</h2>
          <dl className="catalog-source-details">
            <div>
              <dt>Originator</dt>
              <dd>{t.manager ?? sourceName(t.source)}</dd>
            </div>
            {t.sourceType && (
              <div>
                <dt>Source type</dt>
                <dd>
                  {SOURCE_TYPE_LABELS[t.sourceType]}
                  {lastChecked && <small className="catalog-muted"> · checked {lastChecked}</small>}
                </dd>
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
                    <Link className="catalog-link" href={`/explore/trails?resort=${encodeURIComponent(t.skiResort)}`}>
                      {t.skiResort} hiking trails
                    </Link>
                  ) : (
                    t.forest ?? t.park ?? t.blmArea
                  )}
                </dd>
              </div>
            )}
            {t.trailType && (
              <div>
                <dt>Trail type</dt>
                <dd>{TRAIL_TYPE_LABELS[t.trailType]}{t.uses?.length ? ` · ${t.uses.join(", ")}` : ""}</dd>
              </div>
            )}
            {t.trailStatus && t.trailStatus !== "UNKNOWN" && (
              <div>
                <dt>Status</dt>
                <dd>{{ OPEN: "Open", CLOSED: "Closed", SEASONAL: "Seasonal", RESTRICTED: "Access restricted", UNKNOWN: "Not reported" }[t.trailStatus]}</dd>
              </div>
            )}
            <div>
              <dt>Surface</dt>
              <dd>{t.surface ?? "Not reported"}</dd>
            </div>
            {t.originalName && (
              <div>
                <dt>Name in source</dt>
                <dd>{t.originalName}</dd>
              </div>
            )}
            <div>
              <dt>Season</dt>
              <dd>{t.season ?? "Not reported"}</dd>
            </div>
            <div>
              <dt>Source edit date</dt>
              <dd>{t.sourceDate?.slice(0, 10) ?? "Not reported"}</dd>
            </div>
            <div>
              <dt>{t.elevationFt ? "Elevation range" : "Elevation gain"}</dt>
              <dd>
                {t.elevationFt
                  ? `${t.elevationFt.min.toLocaleString("en-US")}–${t.elevationFt.max.toLocaleString("en-US")} ft (sampled; not total gain)`
                  : "Not in source data"}
              </dd>
            </div>
            <div>
              <dt>Catalog snapshot</dt>
              <dd>{manifest.generatedAt.slice(0, 10)}</dd>
            </div>
            {t.quality && (
              <div>
                <dt>Data checks</dt>
                <dd>
                  {QUALITY_STATUS_LABELS[t.quality]} ({manifest.generatedAt.slice(0, 10)})
                  {flags.length > 0 && (
                    <ul className="catalog-flag-list">
                      {flags.map((flag) => (
                        <li key={flag}>{QUALITY_FLAGS[flag]}</li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
            )}
          </dl>
          {t.sources && t.sources.length > 0 && (
            <p className="catalog-muted">
              Also mapped in:{" "}
              {t.sources.map((ref, i) => (
                <span key={`${ref.type}-${ref.id}`}>
                  {i > 0 && " · "}
                  <a href={ref.url} target="_blank" rel="noopener noreferrer">
                    {SOURCE_TYPE_LABELS[ref.type]}
                    {ref.officialTrailId ? ` trail #${ref.officialTrailId}` : ""}
                    {ref.name !== t.name ? ` (“${ref.name}”)` : ""}
                  </a>
                </span>
              ))}
            </p>
          )}
          <p>
            <a href={t.sourceUrl} target="_blank" rel="noopener noreferrer">
              {isRoute ? "Official trail information" : t.source === "resort" ? "Resort’s summer trail information" : "View original source record"}
            </a>
            {t.officialUrl && t.officialUrl !== t.sourceUrl && (
              <>
                {" "}
                ·{" "}
                <a href={t.officialUrl} target="_blank" rel="noopener noreferrer">
                  Land manager’s website
                </a>
              </>
            )}
          </p>
          <p className="catalog-muted">
            {isRoute
              ? `Guide ID: ${t.sourceId}.`
              : t.source === "resort"
                ? `Listed by ${t.skiResort ?? t.manager}; pinned at the resort base area. Entry ID: ${t.sourceId}.`
                : `State or province is estimated from a point on the trail; long trails may cross boundaries. Source ID${sections > 1 ? " of the longest section" : ""}: ${t.sourceId}.`}
          </p>
          {t.country === "CA" && !isRoute && (
            <p className="catalog-muted">
              Contains information licensed under the{" "}
              <a
                href={
                  t.source === "ontario"
                    ? "https://www.ontario.ca/page/open-government-licence-ontario"
                    : "https://open.canada.ca/en/open-government-licence-canada"
                }
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Government Licence – {t.source === "ontario" ? "Ontario" : "Canada"}
              </a>
              .
            </p>
          )}
        </section>
      </div>
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
