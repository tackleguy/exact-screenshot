import type { MetadataRoute } from "next";
import { getTrails } from "@/lib/data";
import { publicCatalogIds } from "@/lib/trail-catalog/server";
import { siteUrl } from "@/lib/site-url";

/** Google accepts up to 50,000 URLs per sitemap file. */
const PER_SITEMAP = 45_000;

/** Sitemap 0 holds the main pages and community trails; the rest split the public trail catalog. */
export async function generateSitemaps() {
  const ids = await publicCatalogIds();
  return Array.from({ length: 1 + Math.ceil(ids.length / PER_SITEMAP) }, (_, id) => ({ id }));
}

export default async function sitemap(props: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  const id = Number(await props.id);
  const base = siteUrl();
  if (id === 0) {
    const trails = await getTrails();
    return [
      { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
      { url: `${base}/explore/trails`, changeFrequency: "daily", priority: 0.9 },
      { url: `${base}/explore/ski`, changeFrequency: "weekly", priority: 0.6 },
      { url: `${base}/map`, changeFrequency: "weekly", priority: 0.6 },
      { url: `${base}/plan`, changeFrequency: "monthly", priority: 0.5 },
      ...trails.map((trail) => ({
        url: `${base}/explore/trails/${trail.id}`,
        lastModified: new Date(trail.updated_at),
        changeFrequency: "weekly" as const,
        priority: 0.8,
      })),
    ];
  }
  const ids = await publicCatalogIds();
  return ids.slice((id - 1) * PER_SITEMAP, id * PER_SITEMAP).map((trailId) => ({
    url: `${base}/explore/trails/${encodeURIComponent(trailId)}`,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));
}
