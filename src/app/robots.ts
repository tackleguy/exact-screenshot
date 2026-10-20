import type { MetadataRoute } from "next";
import { publicCatalogIds } from "@/lib/trail-catalog/server";
import { siteUrl } from "@/lib/site-url";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = siteUrl();
  const files = 1 + Math.ceil((await publicCatalogIds()).length / 45_000);
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/"] },
    sitemap: Array.from({ length: files }, (_, i) => `${base}/sitemap/${i}.xml`),
  };
}
