import Image from "next/image";
import Link from "next/link";
import type { Trail, TrailPhoto } from "@/lib/types";
import { PhotoAttribution } from "./TrailPhotoGallery";

interface TrailHeroProps {
  trail: Trail;
  heroPhoto?: TrailPhoto | null;
}

export function TrailHero({ trail, heroPhoto }: TrailHeroProps) {
  const imageUrl = heroPhoto?.url ?? trail.image_url;

  return (
    <div className="relative h-72 overflow-hidden bg-stone-800 sm:h-96">
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={trail.trail_name}
          fill
          className="object-cover"
          priority
          sizes="100vw"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-900 via-stone-800 to-stone-900" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-10">
        <div className="mx-auto max-w-7xl">
          {trail.park && (
            <Link
              href={`/parks/${trail.park.id}`}
              className="text-sm font-medium text-emerald-300 hover:underline"
            >
              {trail.park.park_name}
            </Link>
          )}
          <h1 className="mt-1 text-3xl font-bold text-white sm:text-4xl">
            {trail.trail_name}
          </h1>
          {trail.confidence_score && trail.confidence_score !== "verified" && (
            <p className="mt-2 text-xs text-stone-300">
              Data confidence: {trail.confidence_score.replace("_", " ")}
            </p>
          )}
          {heroPhoto && (
            <div className="mt-3 max-w-xl rounded-lg bg-black/40 p-2 backdrop-blur">
              <PhotoAttribution photo={heroPhoto} className="!text-stone-200" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
