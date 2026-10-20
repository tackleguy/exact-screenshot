import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import {
  getReviews,
  getTrail,
  getTrailCampsites,
  getTrailElevationProfile,
  getTrailPhotos,
  getTrailTrailheads,
  getTrailWaterSources,
} from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { ReviewsSection } from "@/components/trails/ReviewsSection";
import { MapView } from "@/components/map/MapView";
import { TrailHero } from "@/components/trails/TrailHero";
import { TrailElevationProfile } from "@/components/trails/TrailElevationProfile";
import { TrailPhotoGallery } from "@/components/trails/TrailPhotoGallery";
import { TrailPoisSection } from "@/components/trails/TrailPoisSection";
import { TrailWeatherForecast } from "@/components/trails/TrailWeatherForecast";
import { GpxRouteUpload } from "@/components/trails/GpxRouteUpload";
import { difficultyColor, formatRating } from "@/lib/utils";
import { resolveDifficulty } from "@/lib/trail-difficulty";
import { buildTrailJsonLd } from "@/lib/seo/trail-jsonld";
import type { GeoLineString } from "@/lib/types";
import { getCatalogTrail } from "@/lib/trail-catalog/server";
import { CatalogTrailDetail } from "@/components/trails/CatalogTrailDetail";

/** Dynamic params arrive percent-encoded, e.g. USGS ids with braces. */
function decodeId(raw: string) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const id = decodeId((await params).id);
  if (/^(usgs|parks-canada|ontario|nps|usfs|blm|resort|route)-/.test(id)) {
    const record = await getCatalogTrail(id);
    const isRoute = record?.trail.kind === "route";
    return {
      title: record ? `${record.trail.name} — Hyked` : "Trail not found",
      description: isRoute
        ? "Through-hike guide from the Hyked trail catalog."
        : "Source-linked trail from the Hyked catalog, with map and weather forecast.",
    };
  }
  const trail = await getTrail(id);
  if (!trail) return { title: "Trail not found" };

  const title = `${trail.trail_name}${trail.park ? ` · ${trail.park.park_name}` : ""}`;
  const description =
    trail.description?.slice(0, 160) ||
    `${trail.length_miles} mi · ${trail.elevation_ft.toLocaleString()} ft gain · ${trail.difficulty} hike`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
    },
  };
}

export default async function ExploreTrailDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = decodeId((await params).id);
  if (/^(usgs|parks-canada|ontario|nps|usfs|blm|resort|route)-/.test(id)) {
    const record = await getCatalogTrail(id);
    if (!record) notFound();
    if (record.trail.id !== id) permanentRedirect(`/explore/trails/${encodeURIComponent(record.trail.id)}`);
    return <CatalogTrailDetail {...record} />;
  }
  const trail = await getTrail(id);

  if (!trail) notFound();

  const supabase = await createClient();
  const [reviews, photos, elevationProfile, campsites, waterSources, trailheads] =
    await Promise.all([
      getReviews(id),
      supabase ? getTrailPhotos(supabase, id) : Promise.resolve([]),
      supabase
        ? getTrailElevationProfile(supabase, id)
        : Promise.resolve(trail.elevation_profile ?? []),
      supabase ? getTrailCampsites(supabase, id) : Promise.resolve([]),
      supabase ? getTrailWaterSources(supabase, id) : Promise.resolve([]),
      supabase ? getTrailTrailheads(supabase, id) : Promise.resolve([]),
    ]);

  const jsonLd = buildTrailJsonLd(trail);
  const resolvedDifficulty = resolveDifficulty({
    reported: trail.difficulty,
    communityDifficulty: trail.community_difficulty,
    difficultyRatingCount: trail.difficulty_rating_count,
    miles: trail.length_miles,
    elevationFt: trail.elevation_ft,
    name: trail.trail_name,
    description: trail.description,
  });

  const heroPhoto = photos.find((p) => p.is_hero) ?? photos[0] ?? null;
  const routes: GeoLineString[] = trail.segments?.length
    ? trail.segments
    : trail.geometry
      ? [trail.geometry]
      : [];

  const markers = [
    ...trailheads.map((head) => ({
      id: head.id,
      type: "trailhead" as const,
      name: head.name ?? "Trailhead",
      latitude: head.latitude,
      longitude: head.longitude,
      subtitle: head.parking_info ?? undefined,
      href: `#trailhead-${head.id}`,
    })),
    {
      id: trail.id,
      type: "trail" as const,
      name: trail.trail_name,
      latitude: trail.latitude,
      longitude: trail.longitude,
      href: `/explore/trails/${trail.id}`,
    },
    ...(trail.park
      ? [
          {
            id: trail.park.id,
            type: "park" as const,
            name: trail.park.park_name,
            latitude: trail.park.latitude,
            longitude: trail.park.longitude,
            href: `/parks/${trail.park.id}`,
          },
        ]
      : []),
  ];

  const startHikeHref = `/record/live?type=hike&trail_id=${trail.id}`;
  const weatherLat = trail.start_latitude ?? trail.latitude;
  const weatherLng = trail.start_longitude ?? trail.longitude;

  return (
    <div className="pb-24 md:pb-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <TrailHero trail={trail} heroPhoto={heroPhoto} />

      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <Link
          href={startHikeHref}
          className="mb-8 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-4 text-sm font-semibold text-white shadow-md transition hover:bg-emerald-700 sm:w-auto sm:px-10"
        >
          🥾 Start Hike — GPS tracking
        </Link>

        <div className="mb-10">
          <h2 className="mb-3 text-lg font-semibold text-stone-900">Route map</h2>
          <MapView
            mode="trail"
            markers={markers}
            routes={routes}
            center={[trail.longitude, trail.latitude]}
            zoom={12}
            className="h-80"
            fitToMarkers={routes.length === 0}
            fitToRoutes={routes.length > 0}
          />
        </div>

        <div className="mb-10">
          <h2 className="mb-3 text-lg font-semibold text-stone-900">Elevation profile</h2>
          <TrailElevationProfile
            samples={
              elevationProfile.length > 0
                ? elevationProfile
                : (trail.elevation_profile ?? [])
            }
            className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
          />
        </div>

        <div className="mb-10">
          <TrailPhotoGallery photos={photos} />
        </div>

        <TrailPoisSection
          campsites={campsites}
          waterSources={waterSources}
          trailheads={trailheads}
        />

        <div className="mb-10 grid gap-6 lg:grid-cols-2">
          <TrailWeatherForecast lat={weatherLat} lng={weatherLng} />
          <GpxRouteUpload trailId={trail.id} />
        </div>

        <div className="grid gap-10 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="mb-6 flex flex-wrap gap-3">
              <span
                className={`rounded-full px-3 py-1 text-sm font-semibold capitalize ${difficultyColor(resolvedDifficulty.difficulty)}`}
                title={resolvedDifficulty.label}
              >
                {resolvedDifficulty.difficulty}
              </span>
              <span className="rounded-full bg-surface-muted px-3 py-1 text-sm font-medium text-mist">
                {resolvedDifficulty.label}
              </span>
              <span className="rounded-full bg-surface-muted px-3 py-1 text-sm font-medium text-mist">
                {trail.route_type}
              </span>
              {trail.allows_dogs != null && (
                <span className="rounded-full bg-surface-muted px-3 py-1 text-sm font-medium text-mist">
                  {trail.allows_dogs ? "Dogs allowed" : "No dogs"}
                </span>
              )}
              <span className="rounded-full bg-surface-muted px-3 py-1 text-sm font-medium text-mist">
                ★ {formatRating(trail.avg_rating)} ({trail.review_count} reviews)
              </span>
            </div>

            <p className="leading-relaxed text-stone-700">{trail.description}</p>

            {trail.seasonal_information && (
              <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
                <strong>Seasonal info:</strong> {trail.seasonal_information}
              </p>
            )}

            <ReviewsSection trailId={trail.id} initialReviews={reviews} />
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 font-semibold text-stone-900">Trail stats</h2>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-stone-500">Length</dt>
                  <dd className="font-medium">{trail.length_miles} mi</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-stone-500">Elevation gain</dt>
                  <dd className="font-medium">
                    {trail.elevation_ft.toLocaleString()} ft
                  </dd>
                </div>
                {trail.elevation_loss_ft != null && (
                  <div className="flex justify-between">
                    <dt className="text-stone-500">Elevation loss</dt>
                    <dd className="font-medium">
                      {trail.elevation_loss_ft.toLocaleString()} ft
                    </dd>
                  </div>
                )}
                {trail.duration && (
                  <div className="flex justify-between">
                    <dt className="text-stone-500">Duration</dt>
                    <dd className="font-medium">{trail.duration}</dd>
                  </div>
                )}
                {trail.surface && (
                  <div className="flex justify-between">
                    <dt className="text-stone-500">Surface</dt>
                    <dd className="font-medium">{trail.surface}</dd>
                  </div>
                )}
                {trail.confidence_score && (
                  <div className="flex justify-between">
                    <dt className="text-stone-500">Data confidence</dt>
                    <dd className="font-medium capitalize">
                      {trail.confidence_score.replace("_", " ")}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
